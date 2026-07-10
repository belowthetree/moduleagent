// ============================================================================
// projectHandlers — 项目 IPC handler
// 注册通道: project:scan / project:getTree / project:generateModules
// 项目扫描、模块树构建、MCP 后端初始化、模块自动生成
//
// AgentStateManager、prompts、agentStatus 已移入 Core 层。
// project:scan 委托 initAll() 完成初始化，MCP 后端回调使用 core.modules API。
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG, DEFAULT_MODULE_GEN_ROLE, type RoleConfig } from '../../config/defaults.js';
import { McpBackendServer } from '../../agents/McpBackend.js';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { writeMcpGraphFile } from '../../agents/McpServerBuilder.js';
import { buildPromptBlocks } from '../../agents/PromptBuilder.js';
import { AgentLauncher } from '../../agents/AgentLauncher.js';
import type { ModuleGraphNode } from '../../types/module.js';
import type { ChatMsg, TreeNode } from '../../types/shared.js';

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

      // 初始化核心和角色（Core.init 内部会创建 AgentStateManager 并加载 prompts）
      const result = await ctx.core.init(projectRoot);
      ctx.core.initRoles(config.projectPath, workspaceRoot);
      ctx.core.initWorkflows(config.projectPath, workspaceRoot);

      const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
      fs.mkdirSync(moduleScanPath, { recursive: true });
      const descriptors = await ModuleScanner.scan({
        projectRoot: moduleScanPath,
        extraExclude: config.exclude,
      });

      const graph = new ModuleGraph().build(descriptors, projectRoot);

      // 设置 MCP 后端端口到 core.modules
      ctx.core.modules.mcpBackendPort = 0;
      ctx.core.modules.mcpGraphFile = writeMcpGraphFile(graph, os.tmpdir());

      // 创建 MCP 后端 — 回调委托给 core.modules API
      const mcpBackend = new McpBackendServer({
        getAgentEntry(name) {
          const e = ctx.core.modules.getAgent(name);
          return e ? e.agent : undefined;
        },
        startAgent(name) {
          return ctx.core.modules.startAgent(name)
            .then(() => true)
            .catch((err) => {
              ctx.logger.error(`MCP: failed to auto-start ${name}: ${(err as Error).message}`);
              return false;
            });
        },
        buildPromptBlocks(name, text) {
          return ctx.core.modules.buildPromptBlocksForModule(name, text);
        },
        sendCrossContext(source, target, direction, phase, content) {
          // 更新时间线元数据
          const st = ctx.core.modules.getStreamState(source);
          if (st && st.timeline) {
            for (let i = st.timeline.length - 1; i >= 0; i--) {
              const ev = st.timeline[i]!;
              if (ev.type === 'tool_call' && (ev.content.includes('module_call') || ev.content.includes('module_query'))) {
                if (!ev.crossModule) {
                  ev.crossDirection = direction;
                  ev.crossModule = target;
                  ev.crossPhase = phase;
                  ev.detail = content;
                } else {
                  ev.crossPhase = phase;
                  if (ev.detail) {
                    ev.detail = ev.detail + '\n\n---\n\n' + content;
                  }
                }
                break;
              }
            }
          }

          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            ctx.mainWindow.webContents.send(IpcChannel.Push.CrossContext, {
              moduleName: source,
              crossModule: target,
              direction,
              phase,
              content,
              time: new Date().toLocaleTimeString(),
            });
          }
        },
        setAgentStatus(name, status) {
          ctx.core.modules.setAgentStatus(name, status);
        },
        startStream: (moduleName) => ctx.core.modules.startStream(moduleName),
        finishStream: (moduleName) => ctx.core.modules.finishStream(moduleName),
        saveCrossContext: async (moduleName, msgs) => {
          const existing = await ctx.core.modules.loadContext(moduleName);
          existing.push(...msgs);
          await ctx.core.modules.saveContext(moduleName, existing);
        },
        onLog(level, message) {
          if (level === 'error') ctx.logger.error(message);
          else if (level === 'warn') ctx.logger.warn(message);
          else ctx.logger.info(message);
        },
      });

      const port = await mcpBackend.start();
      ctx.core.modules.mcpBackendPort = port;

      ctx.logger.info(`MCP setup complete: graph=${ctx.core.modules.mcpGraphFile} port=${port}`);

      const nodes: Record<string, ModuleGraphNode> = {};
      for (const [name, node] of graph.nodes) {
        nodes[name] = { ...node, workspacePath: workspaceRoot };
      }
      return { root: graph.root, nodes, moduleCount: descriptors.length };
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

      let agentCommand = config.agents.default.command;
      let agentArgs = config.agents.default.args || [];
      const modules = config.agents.modules;
      if (modules && modules[rootNode.name]) {
        agentCommand = modules[rootNode.name]!.command;
        agentArgs = modules[rootNode.name]!.args || [];
      }

      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');
      let cwd: string;
      if (rootNode.relativePath === '.') {
        cwd = path.join(projectRoot, '.module-agent', 'module');
      } else {
        cwd = path.join(projectRoot, '.module-agent', 'module');
      }

      const subModuleDirs: string[] = [];

      const launcher = new AgentLauncher();
      const launched = await launcher.launch(
        { command: agentCommand, args: agentArgs },
        rootNode.name,
        cwd,
        '',
        ctx.logger,
        { subModuleDirs } as any,
      );

      const graphFile = writeMcpGraphFile(graph);

      const { sessionId } = await (launched as any).connection.newSession({ cwd, mcpServers: [] });

      const projectName = path.basename(projectRoot);
      const mainDescriptors = descriptors.filter(
        d => d.moduleMdPath !== rootModulePath,
      );
      const dirs = mainDescriptors
        .map(d => path.relative(projectRoot, path.dirname(d.moduleMdPath)))
        .filter(Boolean);

      const systemBlock = {
        type: 'text' as const,
        text: `You are a module documentation expert. Your task is to analyze source code directories and generate comprehensive module.md files.

Each module.md must have YAML frontmatter with:
- name: module name — use the relative path from project root
- description: what this module does
- submodules: child modules (name, path, description)

Write each module.md to: ${moduleScanPath}/<relative-path>/module.md
DO NOT overwrite existing module.md files.`,
      };

      const dirsList = dirs.length > 0 ? dirs.map(d => `  - ${d}`).join('\n') : '  (root module only)';
      const userBlock = {
        type: 'text' as const,
        text: `Project: ${projectName}\nProject root: ${projectRoot}\n\nPlease analyze the following source directories and generate module.md for each:\n\n${dirsList}`,
      };

      await (launched as any).connection.prompt({ sessionId, prompt: [systemBlock, userBlock] });
      try { fs.unlinkSync(graphFile); } catch { /* 忽略 */ }

      const newDescriptors = await ModuleScanner.scan({
        projectRoot: moduleScanPath,
        extraExclude: config.exclude,
      });
      const totalCount = new Set(newDescriptors.map(d => d.moduleMdPath)).size;

      return { success: true, count: totalCount };
    } catch (err) {
      ctx.logger.error(`[generateModules] Error: ${(err as Error).message}`);
      return { success: false, count: 0, error: (err as Error).message };
    }
  });
}
