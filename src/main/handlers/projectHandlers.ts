// ============================================================================
// projectHandlers — 项目 IPC handler
// 注册通道: project:scan / project:getTree / project:generateModules
// 项目扫描、模块树构建、模块自动生成
//
// SessionStore、prompts、agentStatus 已移入 Core 层。
// project:scan 委托 core.initAll() 一次性完成：模块扫描 + 角色/工作流初始化
// + MCP 后端装配（跨模块路由器）；Electron 特有的 timeline 跨模块装饰通过
// onCrossModuleContext 钩子注入（跨模块上下文落盘由 Core 内 appendCrossContext 接线）。
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_MODULE_GEN_ROLE } from '../../config/defaults.js';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { writeMcpGraphFile } from '../../agents/mcp/McpServerBuilder.js';
import { KernelFactory, type AgentConfig } from '../../agents/KernelFactory.js';
import { Agent } from '../../agents/Agent.js';
import type { ModuleGraphNode } from '../../types/module.js';
import type { TreeNode } from '../../types/shared.js';

export function registerProjectHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Project.Scan, async (_event, projectRoot: string, _workspaceRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.loadOrCreate(projectRoot);

      // 确保默认的模块生成角色存在
      if (!workspaceConfig.roles) workspaceConfig.roles = [];
      const hasDefaultRole = workspaceConfig.roles.some(r => r.name === DEFAULT_MODULE_GEN_ROLE.name);
      if (!hasDefaultRole) {
        workspaceConfig.roles.push({ ...DEFAULT_MODULE_GEN_ROLE });
        const configPath = path.join(projectRoot, '.module-agent.json');
        await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
        ctx.logger.info('Added default role: 模块生成角色');
      }

      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      ctx.summarizationEnabled = config.summarization?.enabled ?? false;
      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

      // 一次性初始化：模块扫描 + 角色/工作流子系统 + MCP 后端（跨模块路由器）。
      // Electron 特有的 timeline 跨模块装饰通过钩子注入。
      await ctx.core.initAll(projectRoot, undefined, {
        onCrossModuleContext: ({ fromModule, toModule, direction, phase, content }) => {
          // 装饰最近一条 module_call/module_query 工具调用的 timeline 事件
          const st = ctx.core.modules.getStreamState(fromModule);
          if (st && st.timeline) {
            for (let i = st.timeline.length - 1; i >= 0; i--) {
              const ev = st.timeline[i]!;
              if (ev.type === 'tool_call' && (ev.content.includes('module_call') || ev.content.includes('module_query'))) {
                if (!ev.crossModule) {
                  ev.crossDirection = direction;
                  ev.crossModule = toModule;
                  ev.crossPhase = phase;
                  ev.detail = content;
                } else {
                  ev.crossPhase = phase;
                  if (ev.detail) ev.detail = ev.detail + '\n\n---\n\n' + content;
                }
                break;
              }
            }
          }
          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            ctx.mainWindow.webContents.send(IpcChannel.Push.CrossContext, {
              moduleName: fromModule,
              crossModule: toModule,
              direction,
              phase,
              content,
              time: new Date().toLocaleTimeString(),
            });
          }
        },
      });

      // initAll 内部已完成模块扫描，直接取图，避免重复扫描
      const graph = ctx.core.getGraph();
      if (!graph) {
        return { root: '', nodes: {}, moduleCount: 0 };
      }
      const nodes: Record<string, ModuleGraphNode> = {};
      for (const [name, node] of graph.nodes) {
        nodes[name] = { ...node, workspacePath: workspaceRoot };
      }
      return { root: graph.root, nodes, moduleCount: graph.nodes.size };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Project.GetTree, () => {
    const graph = ctx.core.getGraph();
    if (!graph) return null;

    const projectRoot = ctx.core.getProjectRoot();
    const config = ctx.core.modules.getConfig();
    const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

    function buildTree(node: ModuleGraphNode): TreeNode {
      let cwd: string;
      if (config?.projectPath) {
        if (node.relativePath === '.') {
          cwd = path.join(projectRoot, '.module-agent', 'module');
        } else {
          cwd = path.join(workspaceRoot, node.name);
        }
      } else {
        cwd = node.absolutePath || projectRoot;
      }

      return {
        name: node.name,
        path: node.relativePath,
        description: node.definition.frontmatter.description,
        children: node.children
          .map(c => graph!.nodes.get(c))
          .filter(Boolean)
          .map(c => buildTree(c!)),
        cwd,
      };
    }
    const rootNode = graph.nodes.get(graph.root);
    return rootNode ? buildTree(rootNode) : null;
  });

  ipcMain.handle(IpcChannel.Project.GenerateModules, async (_event, projectRoot: string) => {
    let agent: Agent | null = null;
    let graphFile: string | null = null;
    try {
      const workspaceConfig = await ConfigLoader.loadOrCreate(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);

      const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
      fs.ensureDirSync(moduleScanPath);
      const rootModulePath = path.join(moduleScanPath, 'module.md');
      if (!(await fs.pathExists(rootModulePath))) {
        const rootModuleName = path.basename(projectRoot);
        await fs.writeFile(
          rootModulePath,
          `---\nname: ${rootModuleName}\ndescription: ${rootModuleName} project root module\n---\n\n# ${rootModuleName}\n\n## Module Description\n\nTo be filled\n`,
          'utf-8',
        );
      }

      const descriptors = await ModuleScanner.scan({
        projectRoot: moduleScanPath,
        extraExclude: config.exclude,
      });
      const graph = new ModuleGraph().build(descriptors, projectRoot);
      const rootNode = graph.nodes.get(graph.root);
      if (!rootNode) {
        return { success: false, count: 0, error: 'No root module found after scan' };
      }

      // 解析 agent 连接配置（模块级覆盖优先，与 resolveAgentConfig 同规则）
      const def = config.agents.default;
      const mod = config.agents.modules?.[rootNode.name];
      const agentConfig: AgentConfig = {
        provider: mod?.provider || def.provider,
        apiKey: mod?.apiKey || def.apiKey,
        baseUrl: mod?.baseUrl || def.baseUrl,
        model: mod?.model || def.model,
        maxTokens: mod?.maxTokens ?? def.maxTokens,
        fastModel: mod?.fastModel || def.fastModel,
        contextWindow: mod?.contextWindow ?? def.contextWindow,
      };

      // 现有模块图写入临时文件，供 agent 读取解析（finally 中负责清理）
      graphFile = writeMcpGraphFile(graph);

      // 启动临时 agent：生成指令以独立 system 角色注入（前缀缓存锚定）
      const launcher = new KernelFactory();
      agent = await Agent.start({
        name: rootNode.name,
        config: agentConfig,
        cwd: moduleScanPath,
        launcher,
        logger: ctx.logger,
        systemPrompt: `You are a module documentation expert. Your task is to analyze source code directories and generate comprehensive module.md files.

Each module.md must have YAML frontmatter with:
- name: module name — use the relative path from project root
- description: what this module does
- submodules: child modules (name, path, description)

Write each module.md to: ${moduleScanPath}/<relative-path>/module.md
DO NOT overwrite existing module.md files.`,
        onNotification: () => { /* 生成任务在后台执行，无需转发通知 */ },
      });

      const projectName = path.basename(projectRoot);
      const mainDescriptors = descriptors.filter(
        d => d.moduleMdPath !== rootModulePath,
      );
      const dirs = mainDescriptors
        .map(d => path.relative(projectRoot, path.dirname(d.moduleMdPath)))
        .filter(Boolean);
      const dirsList = dirs.length > 0 ? dirs.map(d => `  - ${d}`).join('\n') : '  (root module only)';

      const sendResult = await agent.send([{
        type: 'text',
        text: `Project: ${projectName}\nProject root: ${projectRoot}\n\nThe current module graph JSON (from the scan above) is available at: ${graphFile}\nRead it to understand the existing module structure before generating.\n\nPlease analyze the following source directories and generate module.md for each:\n\n${dirsList}`,
      }]);
      ctx.logger.info(`[generateModules] agent reply: ${sendResult.content.slice(0, 200)}`);

      const newDescriptors = await ModuleScanner.scan({
        projectRoot: moduleScanPath,
        extraExclude: config.exclude,
      });
      const totalCount = new Set(newDescriptors.map(d => d.moduleMdPath)).size;

      return { success: true, count: totalCount };
    } catch (err) {
      ctx.logger.error(`[generateModules] Error: ${(err as Error).message}`);
      return { success: false, count: 0, error: (err as Error).message };
    } finally {
      // 内核模式无子进程，停止 agent 即完成清理；临时模块图文件一并删除
      if (agent) {
        try { agent.stop(); } catch { /* 忽略 */ }
      }
      if (graphFile) {
        try { fs.unlinkSync(graphFile); } catch { /* 忽略 */ }
      }
    }
  });
}
