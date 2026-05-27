// ============================================================================
// projectHandlers — 项目 IPC handler
// 注册通道: project:scan / project:getTree / project:generateModules
// 项目扫描、模块树构建、MCP 后端初始化、模块自动生成
// 这是最大的 handler 文件（~330 行），因为 scan 包含大量初始化逻辑
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG, DEFAULT_MODULE_GEN_ROLE, type RoleConfig } from '../../config/defaults.js';
import { AgentStateManager } from '../../agents/AgentStateManager.js';
import { McpBackendServer } from '../../agents/McpBackend.js';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ModuleGenerator } from '../../core/ModuleGenerator.js';
import { writeMcpGraphFile, buildMcpServers } from '../../agents/McpServerBuilder.js';
import { buildPromptBlocks, loadSystemPrompts } from '../../agents/PromptBuilder.js';
import { AgentLauncher } from '../../agents/AgentLauncher.js';
import { workspacePathForModule, getSubModuleDirs, prepareModuleWorkspace } from '../../agents/WorkspaceIsolator.js';
import type { ModuleGraphNode } from '../../types/module.js';
import type { ChatMsg, TreeNode } from '../../types/shared.js';
import { defaultLogger } from '../../core/Logger.js';

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
      ctx.summarizationEnabled = config.summarization?.enabled ?? true;
      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

      // 从解析后的 config 目录加载提示词
      ctx.prompts = { ...loadSystemPrompts(ctx.configDir), rolePrompt: '' };
      try {
        const rpPath = path.join(ctx.configDir, 'knowledge', 'roleagentprompt.md');
        ctx.prompts.rolePrompt = fs.readFileSync(rpPath, 'utf-8');
      } catch { /* 可选 */ }

      // 初始化核心和角色（在模块扫描之前，这样即使扫描失败角色也可用）
      const result = await ctx.core.init(projectRoot);
      ctx.core.initRoles(config.projectPath, workspaceRoot);
      ctx.core.initWorkflows(config.projectPath, workspaceRoot);

      // 提前初始化状态管理器——必须在任何流开始之前，以及在可能抛出异常并跳过后续初始化的模块扫描之前
      ctx.stateManager = new AgentStateManager(
        path.join(projectRoot, '.module-agent', 'context'),
      );

      const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
      fs.mkdirSync(moduleScanPath, { recursive: true });
      const descriptors = await ModuleScanner.scan({
        projectRoot: moduleScanPath,
        extraExclude: config.exclude,
      });

      const graph = new ModuleGraph().build(descriptors, projectRoot);

      // 设置 MCP 后端端口到 core.modules
      ctx.core.modules.mcpBackendPort = 0; // Will be set after backend starts
      ctx.core.modules.mcpGraphFile = writeMcpGraphFile(graph, os.tmpdir());

      // 创建 MCP 后端
      ctx.mcpBackend = new McpBackendServer({
        getAgentEntry(name) {
          const e = ctx.core.modules.getAgent(name);
          return e ? { launched: e.launched, sessionId: e.sessionId } : undefined;
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
          return buildPromptBlocks({
            moduleName: name,
            userText: text,
            graph: graph!,
            prompts: ctx.prompts,
            sessionPrompted: new Set(),
          });
        },
        sendCrossContext(source, target, direction, phase, content) {
          // 管理跨模块请求目标模块的 stateManager 生命周期。
          // 目标模块接收这些方向/阶段配对：
          //   received+request → 请求到达，开始流积累
          //   sent+response    → 响应就绪，完成并持久化上下文
          if (direction === 'received' && phase === 'request') {
            ctx.stateManager?.startStream(source);
          } else if (direction === 'sent' && phase === 'response') {
            const acc = ctx.stateManager?.finishStream(source);
            if (acc) {
              const timeStr = new Date().toLocaleTimeString();
              const agentMsg: ChatMsg = {
                id: 'x' + Date.now().toString(36),
                role: 'agent',
                content: acc.reply || '',
                thinking: acc.thinking || '',
                timeline: acc.timeline || [],
                time: timeStr,
                status: 'completed',
                moduleName: source,
              };
              ctx.stateManager?.loadContext(source).then(existing => {
                existing.push(agentMsg);
                ctx.stateManager?.saveContext(source, existing);
              }).catch(() => {});
            }
          }

          // 更新 stateManager 时间线以便跨模块元数据被持久化
          const st = ctx.stateManager?.getStreamState(source);
          if (st && st.timeline) {
            for (let i = st.timeline.length - 1; i >= 0; i--) {
              const ev = st.timeline[i]!;
              if (ev.type === 'tool_call' && (ev.content.includes('module_call') || ev.content.includes('module_query'))) {
                // 仅在第一个事件（请求）上设置跨模块元数据；响应追加细节
                if (!ev.crossModule) {
                  ev.crossDirection = direction;
                  ev.crossModule = target;
                  ev.crossPhase = phase;
                  ev.detail = content;
                } else {
                  // 响应：追加到现有详情，保持原始方向/模块
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
          ctx.agentStatus.set(name, status);
          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            ctx.mainWindow.webContents.send(IpcChannel.Push.AgentStatus, { name, status });
          }
        },
        onLog(level, message) {
          if (level === 'error') ctx.logger.error(message);
          else if (level === 'warn') ctx.logger.warn(message);
          else ctx.logger.info(message);
        },
      });

      const port = await ctx.mcpBackend.start();
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
          cwd = workspacePathForModule(node, workspaceRoot, projectRoot);
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
        agentArgs = modules[rootNode.name]!.args;
      }

      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');
      let cwd: string;
      if (rootNode.relativePath === '.') {
        cwd = path.join(projectRoot, '.module-agent', 'module');
      } else {
        cwd = await prepareModuleWorkspace(rootNode, {
          workspaceRoot,
          projectPath: config.projectPath,
          graph,
        });
      }

      const subModuleDirs = getSubModuleDirs(rootNode, graph, (n) =>
        workspacePathForModule(n, workspaceRoot, projectRoot),
      );

      const launcher = new AgentLauncher();
      const launched = await launcher.launch(
        { command: agentCommand, args: agentArgs },
        rootNode.name,
        cwd,
        defaultLogger,
        { subModuleDirs },
      );

      const basePath = ctx._getBasePath();
      const graphFile = writeMcpGraphFile(graph);
      const mcpServers = buildMcpServers({
        moduleName: rootNode.name,
        basePath,
        graphFile,
      });

      const { sessionId } = await launched.connection.newSession({ cwd, mcpServers });

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

      await launched.connection.prompt({ sessionId, prompt: [systemBlock, userBlock] });
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
