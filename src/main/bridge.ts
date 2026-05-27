import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG, DEFAULT_MODULE_GEN_ROLE, type RoleConfig } from '../config/defaults.js';
import { defaultLogger, type Logger } from '../core/Logger.js';
import { AgentStateManager } from '../agents/AgentStateManager.js';
import { McpBackendServer } from '../agents/McpBackend.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import { cleanupRoleWorkspace } from '../agents/RoleWorkspace.js';
import * as WorkspaceDiff from '../core/WorkspaceDiff.js';
import { ModuleScanner } from '../core/ModuleScanner.js';
import { ModuleGraph } from '../core/ModuleGraph.js';
import { ModuleGenerator } from '../core/ModuleGenerator.js';
import {
  writeMcpGraphFile,
  buildMcpServers,
} from '../agents/McpServerBuilder.js';
import {
  loadSystemPrompts,
  buildPromptBlocks,
} from '../agents/PromptBuilder.js';
import { AgentLauncher, type AgentConfig } from '../agents/AgentLauncher.js';
import {
  workspacePathForModule,
  getSubModuleDirs,
  prepareModuleWorkspace,
} from '../agents/WorkspaceIsolator.js';
import { getPromptConfigDir, ensureConfigFiles, getUserConfigRoot, configExplorer } from '../core/ConfigPaths.js';
import type { ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../types/module.js';
import type { ChatMsg, TreeNode, DiffSummary } from '../types/preload.js';
import type { CoreCallbacks } from '../core/CoreTypes.js';

// ---------------------------------------------------------------------------
// ElectronBridge — Electron 桥接层
// ---------------------------------------------------------------------------

export class ElectronBridge {
  private mainWindow: BrowserWindow;
  private core: ModuleAgentCore;
  private stateManager: AgentStateManager | null = null;
  private mcpBackend: McpBackendServer | null = null;
  private summarizer: ExperienceSummarizer;
  private summarizationEnabled = true;
  private logger: Logger;
  private configDir: string;

  private prompts = { mainPrompt: '', subPrompt: '', rolePrompt: '' };

  // 按模块状态（用于 IPC 状态报告）
  private agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
  private sendLock = new Map<string, Promise<void>>();
  private roleSendLock = new Map<string, Promise<void>>();
  private diffCache = new Map<string, DiffSummary>();

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logger = defaultLogger;
    this.summarizer = new ExperienceSummarizer(this.logger);

    const basePath = this._getBasePath();
    this.configDir = getPromptConfigDir(basePath);
    ensureConfigFiles(path.join(basePath, 'config'));

    const callbacks: CoreCallbacks = this._buildCallbacks();

    this.core = new ModuleAgentCore({
      callbacks,
      basePath,
      configDir: this.configDir,
      logger: this.logger,
      onSessionUpdate: (moduleName, sessionId, notification) => {
        // 转发到 AgentStateManager 进行累加
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        this.stateManager?.appendChunk(moduleName, update || '', notification.update as Record<string, unknown>);
        const acc = this.stateManager?.getStreamState(moduleName);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('agent:stream', {
            moduleName,
            sessionId,
            update,
            data: notification.update,
            reply: acc?.reply,
            thinking: acc?.thinking,
            tools: acc?.tools,
            timeline: acc?.timeline,
            sections: acc?.sections,
          });
        }
      },
      onRoleSessionUpdate: (roleName, sessionId, notification) => {
        const ctxKey = `workrole:${roleName}`;
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        this.stateManager?.appendChunk(ctxKey, update || '', notification.update as Record<string, unknown>);
        const acc = this.stateManager?.getStreamState(ctxKey);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('role:stream', {
            moduleName: roleName,
            sessionId,
            update,
            data: notification.update,
            reply: acc?.reply,
            thinking: acc?.thinking,
            tools: acc?.tools,
            timeline: acc?.timeline,
            sections: acc?.sections,
          });
        }
      },
    });
  }

  // -----------------------------------------------------------------------
  // IPC 注册
  // -----------------------------------------------------------------------

  registerAllHandlers(): void {
    this._registerDialogHandlers();
    this._registerProjectHandlers();
    this._registerAgentHandlers();
    this._registerContextHandlers();
    this._registerConfigHandlers();
    this._registerRoleHandlers();
    this._registerWorkflowHandlers();
    this._registerMigrationHandlers();
    this._registerKnowledgeHandlers();
  }

  // -----------------------------------------------------------------------
  // 清理
  // -----------------------------------------------------------------------

  async cleanup(): Promise<void> {
    await this.core.dispose();
    try { this.mcpBackend?.stop(); } catch { /* 忽略 */ }
    if (this.core.modules.mcpGraphFile) {
      try { fs.unlinkSync(this.core.modules.mcpGraphFile); } catch { /* 忽略 */ }
    }
  }

  // -----------------------------------------------------------------------
  // 私有：回调
  // -----------------------------------------------------------------------

  private _buildCallbacks(): CoreCallbacks {
    const send = (channel: string, data: unknown) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    };

    return {
      onStreamChunk: () => { /* 通过 onSessionUpdate 处理 */ },
      onStreamComplete: () => { /* 通过 onSessionUpdate 处理 */ },
      onStreamError: (moduleName, error) => {
        this.agentStatus.set(moduleName, 'error');
        send('agent:status', { name: moduleName, status: 'error' });
        this.logger.error(`[${moduleName}] stream error: ${error}`);
      },
      onStatusChange: () => { /* 状态按模块管理 */ },
      onMessage: () => { /* 消息通过各模块流处理 */ },
    };
  }

  private _getBasePath(): string {
    // app.getAppPath() 返回 Electron 应用根目录
    try {
      const { app } = require('electron');
      return app.getAppPath();
    } catch {
      return process.cwd();
    }
  }

  // -----------------------------------------------------------------------
  // 私有：IPC 处理器注册
  // -----------------------------------------------------------------------

  private _registerDialogHandlers(): void {
    ipcMain.handle('dialog:selectDir', async (_event, title: string) => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory'],
        title,
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    });
  }

  private _registerProjectHandlers(): void {
    const self = this;

    ipcMain.handle('project:scan', async (_event, projectRoot: string, _workspaceRoot: string) => {
      try {
        const workspaceConfig = await ConfigLoader.loadOrCreate(projectRoot);

        // 确保默认的模块生成角色存在
        if (!workspaceConfig.roles) workspaceConfig.roles = [];
        const hasDefaultRole = workspaceConfig.roles.some(r => r.name === DEFAULT_MODULE_GEN_ROLE.name);
        if (!hasDefaultRole) {
          workspaceConfig.roles.push({ ...DEFAULT_MODULE_GEN_ROLE });
          const configPath = path.join(projectRoot, '.module-agent.json');
          await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
          self.logger.info('Added default role: 模块生成角色');
        }

        const config = ConfigLoader.getDefaultConfig(workspaceConfig);
        self.summarizationEnabled = config.summarization?.enabled ?? true;
        const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

        // 从解析后的 config 目录加载提示词
        self.prompts = { ...loadSystemPrompts(self.configDir), rolePrompt: '' };
        try {
          const rpPath = path.join(self.configDir, 'knowledge', 'roleagentprompt.md');
          self.prompts.rolePrompt = fs.readFileSync(rpPath, 'utf-8');
        } catch { /* 可选 */ }

        // 初始化核心和角色（在模块扫描之前，这样即使扫描失败角色也可用）
        const result = await self.core.init(projectRoot);
        self.core.initRoles(config.projectPath, workspaceRoot);
        self.core.initWorkflows(config.projectPath, workspaceRoot);

        // 提前初始化状态管理器——必须在任何流开始之前，以及在可能抛出异常并跳过后续初始化的模块扫描之前
        self.stateManager = new AgentStateManager(
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
        self.core.modules.mcpBackendPort = 0; // Will be set after backend starts
        self.core.modules.mcpGraphFile = writeMcpGraphFile(graph, os.tmpdir());

        // 创建 MCP 后端
        self.mcpBackend = new McpBackendServer({
          getAgentEntry(name) {
            const e = self.core.modules.getAgent(name);
            return e ? { launched: e.launched, sessionId: e.sessionId } : undefined;
          },
          startAgent(name) {
            return self.core.modules.startAgent(name)
              .then(() => true)
              .catch((err) => {
                self.logger.error(`MCP: failed to auto-start ${name}: ${(err as Error).message}`);
                return false;
              });
          },
          buildPromptBlocks(name, text) {
            return buildPromptBlocks({
              moduleName: name,
              userText: text,
              graph: graph!,
              prompts: self.prompts,
              sessionPrompted: new Set(),
            });
          },
          sendCrossContext(source, target, direction, phase, content) {
            // 管理跨模块请求目标模块的 stateManager 生命周期。
            // 目标模块接收这些方向/阶段配对：
            //   received+request → 请求到达，开始流积累
            //   sent+response    → 响应就绪，完成并持久化上下文
            if (direction === 'received' && phase === 'request') {
              self.stateManager?.startStream(source);
            } else if (direction === 'sent' && phase === 'response') {
              const acc = self.stateManager?.finishStream(source);
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
                self.stateManager?.loadContext(source).then(existing => {
                  existing.push(agentMsg);
                  self.stateManager?.saveContext(source, existing);
                }).catch(() => {});
              }
            }

            // 更新 stateManager 时间线以便跨模块元数据被持久化
            const st = self.stateManager?.getStreamState(source);
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
            if (self.mainWindow && !self.mainWindow.isDestroyed()) {
              self.mainWindow.webContents.send('agent:cross-context', {
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
            self.agentStatus.set(name, status);
            if (self.mainWindow && !self.mainWindow.isDestroyed()) {
              self.mainWindow.webContents.send('agent:status', { name, status });
            }
          },
          onLog(level, message) {
            if (level === 'error') self.logger.error(message);
            else if (level === 'warn') self.logger.warn(message);
            else self.logger.info(message);
          },
        });

        const port = await self.mcpBackend.start();
        self.core.modules.mcpBackendPort = port;

        self.logger.info(`MCP setup complete: graph=${self.core.modules.mcpGraphFile} port=${port}`);

        const nodes: Record<string, ModuleGraphNode> = {};
        for (const [name, node] of graph.nodes) {
          nodes[name] = { ...node, workspacePath: workspaceRoot };
        }
        return { root: graph.root, nodes, moduleCount: descriptors.length };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('project:getTree', () => {
      const graph = self.core.getGraph();
      if (!graph) return null;

      const projectRoot = self.core.getProjectRoot();
      const config = self.core.modules.getConfig();
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

    ipcMain.handle('project:generateModules', async (_event, projectRoot: string) => {
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

        const basePath = self._getBasePath();
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
        self.logger.error(`[generateModules] Error: ${(err as Error).message}`);
        return { success: false, count: 0, error: (err as Error).message };
      }
    });
  }

  private _registerAgentHandlers(): void {
    const self = this;

    ipcMain.handle('agent:start', async (_event, moduleName: string) => {
      if (!self.core.isInitialized()) return { error: 'no module graph loaded' };
      const existing = self.core.modules.getAgent(moduleName);
      if (existing) return { sessionId: existing.sessionId };
      try {
        const entry = await self.core.modules.startAgent(moduleName);
        return { sessionId: entry.sessionId };
      } catch (err) {
        self.logger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
        self.agentStatus.set(moduleName, 'error');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'error' });
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('agent:send', async (_event, moduleName: string, text: string) => {
      if (!self.core.isInitialized()) return { error: 'no module graph loaded' };

      const prevLock = self.sendLock.get(moduleName);
      if (prevLock) {
        try { await prevLock; } catch { /* 继续 */ }
      }
      let resolveLock: () => void = () => {};
      const lockPromise = new Promise<void>(r => { resolveLock = r; });
      self.sendLock.set(moduleName, lockPromise);

      try {
        let entry = self.core.modules.getAgent(moduleName);
        if (!entry) {
          entry = await self.core.modules.startAgent(moduleName);
        }

        self.agentStatus.set(moduleName, 'streaming');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'streaming' });

        const promptBlocks = buildPromptBlocks({
          moduleName,
          userText: text,
          graph: self.core.getGraph()!,
          prompts: self.prompts,
          sessionPrompted: new Set(),
        });

        self.stateManager?.startStream(moduleName);

        self.logger.info(`agent:send [${moduleName}] len=${text.length} blocks=${promptBlocks.length}`);
        const result = await entry.launched.connection.prompt({
          sessionId: entry.sessionId,
          prompt: promptBlocks,
        });

        const acc = self.stateManager?.finishStream(moduleName);

        // 保存上下文
        const timeStr = new Date().toLocaleTimeString();
        const agentCmd = entry.config.command || '';
        const userMsg: ChatMsg = {
          id: 'm' + Date.now().toString(36),
          role: 'user',
          content: text,
          thinking: '',
          time: timeStr,
          status: 'sent',
          moduleName,
          sessionId: entry.sessionId,
        };
        const agentMsg: ChatMsg = {
          id: 'm' + (Date.now() + 1).toString(36),
          role: 'agent',
          content: acc?.reply || '',
          thinking: acc?.thinking || '',
          timeline: acc?.timeline || [],
          time: timeStr,
          status: 'completed',
          moduleName,
        };
        const existingMsgs = await self.stateManager?.loadContext(moduleName) ?? [];
        existingMsgs.push(userMsg, agentMsg);
        await self.stateManager?.saveContext(moduleName, existingMsgs);

        // 触发即忘的经验总结（后台执行）
        const projectRoot = self.core.getProjectRoot();
        if (projectRoot && self.summarizationEnabled) {
          self.logger.info(`Triggering summarizer for [${moduleName}]`);
          self.summarizer.summarize({
            moduleName,
            chatMsgs: existingMsgs,
            projectRoot,
            configDir: self.configDir,
            agentConfig: { command: entry.config.command, args: entry.config.args },
          }).catch(err => {
            self.logger.warn(`Summarizer error [${moduleName}]: ${(err as Error).message}`);
          });
        }

        // ── 触发工作区变更检测（后台异步） ──
        self._triggerWorkspaceDiff(moduleName, entry.launched.cwd, projectRoot);

        self.agentStatus.set(moduleName, 'idle');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });

        return {
          result: {
            reply: acc?.reply || '',
            thinking: acc?.thinking || '',
            tools: acc?.tools || '',
            timeline: acc?.timeline || [],
            stopReason: result.stopReason,
          },
        };
      } catch (err) {
        self.logger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
        self.stateManager?.stopStream(moduleName);
        self.agentStatus.set(moduleName, 'error');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'error' });
        return { error: (err as Error).message };
      } finally {
        resolveLock();
        self.sendLock.delete(moduleName);
      }
    });

    ipcMain.handle('agent:cancel', async (_event, moduleName: string) => {
      const entry = self.core.modules.getAgent(moduleName);
      if (entry) {
        try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* 忽略 */ }
        self.agentStatus.set(moduleName, 'idle');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });
      }
      const acc = self.stateManager?.cancelStream(moduleName);
      return { accumulated: acc };
    });

    ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
      const entry = self.core.modules.getAgent(moduleName);
      if (entry) {
        try { entry.launched.process.kill(); } catch { /* 忽略 */ }
        // 通过内部访问直接从 agents 映射中移除
        (self.core.modules as any).agents?.delete?.(moduleName);
        self.agentStatus.delete(moduleName);
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'stopped' });
      }
      self.stateManager?.stopStream(moduleName);
      return {};
    });

    ipcMain.handle('agent:isRunning', (_event, moduleName: string) => {
      return self.core.modules.getAgent(moduleName) !== undefined;
    });

    ipcMain.handle('agent:getRunning', () => {
      return self.core.modules.listAgents().map(name => ({
        name,
        status: self.agentStatus.get(name) || 'idle',
      }));
    });
  }

  private _registerContextHandlers(): void {
    const self = this;

    ipcMain.handle('context:get', async (_event, moduleName: string) => {
      return self.stateManager?.loadContext(moduleName) ?? [];
    });

    ipcMain.handle('context:clear', async (_event, moduleName: string) => {
      await self.stateManager?.clearContext(moduleName);
    });

    ipcMain.handle('context:clearAll', async () => {
      await self.stateManager?.clearAllContexts();
    });
  }

  private _registerConfigHandlers(): void {
    ipcMain.handle('config:save', async (_event, projectRoot: string, updates: { command?: string; args?: string[]; projectPath?: string; summarizationEnabled?: boolean }) => {
      const configPath = path.join(projectRoot, '.module-agent.json');
      let workspaceConfig;
      try {
        workspaceConfig = await ConfigLoader.load(projectRoot);
      } catch {
        workspaceConfig = { configs: [{ name: 'default', ...DEFAULT_CONFIG }], defaultConfig: 'default' };
      }
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      if (updates.command) config.agents.default.command = updates.command;
      if (updates.args) config.agents.default.args = updates.args;
      if (updates.projectPath !== undefined) config.projectPath = updates.projectPath;
      if (updates.summarizationEnabled !== undefined) {
        config.summarization = { enabled: updates.summarizationEnabled };
        this.summarizationEnabled = updates.summarizationEnabled;
      }
      await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
      this.logger.info(`config:save wrote to ${configPath}`);
      return { success: true };
    });

    ipcMain.handle('config:get', async (_event, projectRoot: string) => {
      try {
        const workspaceConfig = await ConfigLoader.load(projectRoot);
        const config = ConfigLoader.getDefaultConfig(workspaceConfig);
        return {
          command: config.agents.default.command,
          args: config.agents.default.args || [],
          projectPath: config.projectPath,
          summarizationEnabled: config.summarization?.enabled ?? true,
        };
      } catch {
        return {
          command: DEFAULT_CONFIG.agents.default.command,
          args: DEFAULT_CONFIG.agents.default.args || [],
          projectPath: DEFAULT_CONFIG.projectPath,
          summarizationEnabled: true,
        };
      }
    });
  }

  private _registerRoleHandlers(): void {
    const self = this;

    ipcMain.handle('role:list', async () => {
      try {
        const workspaceConfig = await ConfigLoader.load(self.core.getProjectRoot() || process.cwd());
        return workspaceConfig.roles || [];
      } catch {
        return [];
      }
    });

    ipcMain.handle('role:save', async (_event, role: RoleConfig) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      try {
        const configPath = path.join(projectRoot, '.module-agent.json');
        let workspaceConfig = await ConfigLoader.load(projectRoot);
        if (!workspaceConfig.roles) workspaceConfig.roles = [];
        const idx = workspaceConfig.roles.findIndex(r => r.name === role.name);
        if (idx >= 0) {
          workspaceConfig.roles[idx] = role;
        } else {
          workspaceConfig.roles.push(role);
        }
        await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
        configExplorer.clearCaches();
        return { success: true };
      } catch (err) {
        self.logger.error(`role:save failed: ${(err as Error).message}`);
        return { success: false };
      }
    });

    ipcMain.handle('role:delete', async (_event, name: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      try {
        const configPath = path.join(projectRoot, '.module-agent.json');
        let workspaceConfig = await ConfigLoader.load(projectRoot);
        if (workspaceConfig.roles) {
          workspaceConfig.roles = workspaceConfig.roles.filter(r => r.name !== name);
        }
        await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
        configExplorer.clearCaches();

        const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');
        await cleanupRoleWorkspace(name, workspaceRoot);
        await self.core.roles?.stopRole(name);
        return { success: true };
      } catch (err) {
        self.logger.error(`role:delete failed: ${(err as Error).message}`);
        return { success: false };
      }
    });

    ipcMain.handle('role:start', async (_event, roleName: string) => {
      if (!self.core.roles) return { error: 'no role agent manager' };
      const existing = self.core.roles.getAgent(roleName);
      if (existing) return { sessionId: existing.sessionId };
      try {
        const workspaceConfig = await ConfigLoader.load(self.core.getProjectRoot());
        const role = workspaceConfig.roles?.find(r => r.name === roleName);
        if (!role) return { error: `role not found: ${roleName}` };
        const entry = await self.core.roles.startRole(role);
        return { sessionId: entry.sessionId };
      } catch (err) {
        self.logger.error(`role:start failed [${roleName}]: ${(err as Error).message}`);
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('role:send', async (_event, roleName: string, text: string) => {
      if (!self.core.roles) return { error: 'no role agent manager' };

      const prevLock = self.roleSendLock.get(roleName);
      if (prevLock) try { await prevLock; } catch { /* 继续 */ }
      let resolveLock: () => void = () => {};
      const lockPromise = new Promise<void>(r => { resolveLock = r; });
      self.roleSendLock.set(roleName, lockPromise);

      try {
        // 确保 Agent 已启动（通常通过 role:start 启动，但在此做保护）
        let entry = self.core.roles.getAgent(roleName);
        if (!entry) {
          const workspaceConfig = await ConfigLoader.load(self.core.getProjectRoot());
          const role = workspaceConfig.roles?.find(r => r.name === roleName);
          if (!role) return { error: `role not found: ${roleName}` };
          entry = await self.core.roles.startRole(role);
        }

        const ctxKey = `workrole:${roleName}`;
        self.stateManager?.startStream(ctxKey);

        const promptBlocks = self.core.roles!.buildPromptBlocks(roleName, text);
        self.logger.info(`role:send [${roleName}] len=${text.length}`);
        const result = await entry.launched.connection.prompt({
          sessionId: entry.sessionId,
          prompt: promptBlocks,
        });

        const acc = self.stateManager?.finishStream(ctxKey);

        const timeStr = new Date().toLocaleTimeString();
        const userMsg: ChatMsg = {
          id: 'r' + Date.now().toString(36),
          role: 'user',
          content: text,
          thinking: '',
          time: timeStr,
          status: 'sent',
          moduleName: ctxKey,
        };
        const agentMsg: ChatMsg = {
          id: 'r' + (Date.now() + 1).toString(36),
          role: 'agent',
          content: acc?.reply || '',
          thinking: acc?.thinking || '',
          timeline: acc?.timeline || [],
          time: timeStr,
          status: 'completed',
          moduleName: ctxKey,
        };
        const existingMsgs = await self.stateManager?.loadContext(ctxKey) ?? [];
        existingMsgs.push(userMsg, agentMsg);
        await self.stateManager?.saveContext(ctxKey, existingMsgs);

        return {
          result: {
            reply: acc?.reply || '',
            thinking: acc?.thinking || '',
            tools: acc?.tools || '',
            timeline: acc?.timeline || [],
            stopReason: result.stopReason,
          },
        };
      } catch (err) {
        self.logger.error(`role:send failed [${roleName}]: ${(err as Error).message}`);
        const ctxKey = `workrole:${roleName}`;
        self.stateManager?.stopStream(ctxKey);
        return { error: (err as Error).message };
      } finally {
        resolveLock();
        self.roleSendLock.delete(roleName);
      }
    });

    ipcMain.handle('role:cancel', async (_event, roleName: string) => {
      const entry = self.core.roles?.getAgent(roleName);
      if (entry) {
        try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* 忽略 */ }
      }
      const ctxKey = `workrole:${roleName}`;
      const acc = self.stateManager?.cancelStream(ctxKey);
      return { accumulated: acc };
    });

    ipcMain.handle('role:stop', async (_event, roleName: string) => {
      await self.core.roles?.stopRole(roleName);
      const ctxKey = `workrole:${roleName}`;
      self.stateManager?.stopStream(ctxKey);
      return {};
    });

    ipcMain.handle('role:isRunning', (_event, roleName: string) => {
      return self.core.roles?.getAgent(roleName) !== undefined;
    });

    ipcMain.handle('role:getContext', async (_event, roleName: string) => {
      const ctxKey = `workrole:${roleName}`;
      return self.stateManager?.loadContext(ctxKey) ?? [];
    });

    ipcMain.handle('role:clearContext', async (_event, roleName: string) => {
      const ctxKey = `workrole:${roleName}`;
      await self.stateManager?.clearContext(ctxKey);
    });
  }

  private _registerWorkflowHandlers(): void {
    const self = this;

    ipcMain.handle('workflow:list', async () => {
      if (!self.core.workflows) return [];
      try {
        const names = self.core.workflows.listWorkflows();
        return names.map(name => {
          const wf = self.core.workflows!.loadWorkflow(name);
          return { name, stepCount: wf?.steps.length ?? 0 };
        });
      } catch { return []; }
    });

    ipcMain.handle('workflow:load', async (_event, name: string) => {
      if (!self.core.workflows) return { error: 'workflow subsystem not initialized' };
      try {
        const wf = self.core.workflows.loadWorkflow(name);
        if (!wf) return { error: `workflow not found: ${name}` };
        return { workflow: wf };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:execute', async (_event, name: string, userInput?: string) => {
      if (!self.core.workflows) return { error: 'workflow subsystem not initialized' };
      try {
        const results = await self.core.workflows.executeWorkflow(name, userInput);
        return { success: true, results };
      } catch (err) {
        self.logger.error(`workflow:execute [${name}] failed: ${(err as Error).message}`);
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:cancel', async (_event, name: string) => {
      if (!self.core.workflows) return;
      await self.core.workflows.cancel(name);
    });

    ipcMain.handle('workflow:status', async (_event, name: string) => {
      if (!self.core.workflows) return null;
      const state = self.core.workflows.getExecutionState(name);
      if (!state) return null;
      return {
        status: state.status,
        currentStep: state.currentStepIndex,
        totalSteps: state.stepResults.length,
        results: state.stepResults,
      };
    });

    // ── CRUD operations ──

    ipcMain.handle('workflow:create', async (_event, name: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false, error: 'no project root' };
      try {
        const wfDir = path.join(projectRoot, '.module-agent', 'workflow', name);
        const stepDir = path.join(wfDir, 'step1');
        await fs.ensureDir(stepDir);
        const stepMd = [
          '---',
          'name: ' + name,
          '---',
          '',
          '# ' + name,
          '',
          '请描述第一步要完成的工作...',
        ].join('\n');
        await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
        self.logger.info(`workflow:create [${name}] created at ${wfDir}`);
        return { success: true };
      } catch (err) {
        self.logger.error(`workflow:create [${name}] failed: ${(err as Error).message}`);
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:delete', async (_event, name: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      try {
        const wfDir = path.join(projectRoot, '.module-agent', 'workflow', name);
        if (fs.existsSync(wfDir)) {
          await fs.remove(wfDir);
        }
        // Also clean up state file
        const stateFile = path.join(projectRoot, '.module-agent', 'workflow', `${name}.state.json`);
        if (fs.existsSync(stateFile)) await fs.promises.unlink(stateFile);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:stepSave', async (_event, wfName: string, stepName: string, content: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      try {
        const filePath = path.join(projectRoot, '.module-agent', 'workflow', wfName, stepName, 'STEP.md');
        await fs.ensureDir(path.dirname(filePath));
        await fs.promises.writeFile(filePath, content, 'utf-8');
        self.logger.info(`workflow:stepSave [${wfName}/${stepName}]`);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:stepDelete', async (_event, wfName: string, stepName: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false };
      try {
        const stepDir = path.join(projectRoot, '.module-agent', 'workflow', wfName, stepName);
        if (fs.existsSync(stepDir)) await fs.remove(stepDir);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('workflow:stepAdd', async (_event, wfName: string) => {
      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { success: false, error: 'no project root' };
      try {
        const wfDir = path.join(projectRoot, '.module-agent', 'workflow', wfName);
        // Find next step number
        let maxN = 0;
        if (fs.existsSync(wfDir)) {
          const entries = fs.readdirSync(wfDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && e.name.startsWith('step')) {
              const n = parseInt(e.name.replace('step', ''), 10);
              if (!isNaN(n) && n > maxN) maxN = n;
            }
          }
        }
        const nextStep = `step${maxN + 1}`;
        const stepDir = path.join(wfDir, nextStep);
        await fs.ensureDir(stepDir);
        const stepMd = [
          '---',
          'name: ' + nextStep,
          '---',
          '',
          '# ' + nextStep,
          '',
          '请描述此步骤要完成的工作...',
        ].join('\n');
        await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
        return { success: true, stepName: nextStep };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    });
  }

  private _registerMigrationHandlers(): void {
    const self = this;

    ipcMain.handle('migrate:check', async (_event, keys: string[]) => {
      if (!self.stateManager) return { needed: [], streamNeeded: false };
      const needed: string[] = [];
      for (const key of keys) {
        if (key.startsWith('ctx_')) {
          const moduleName = key.slice(4);
          const existing = await self.stateManager.loadContext(moduleName);
          if (existing.length === 0) needed.push(key);
        }
      }
      const streamNeeded = keys.includes('stream_snapshot');
      return { needed, streamNeeded };
    });

    ipcMain.handle('migrate:data', async (_event, payload: { moduleName: string; msgs: ChatMsg[] }) => {
      if (!self.stateManager) return;
      await self.stateManager.saveContext(payload.moduleName, payload.msgs);
    });
  }

  private _registerKnowledgeHandlers(): void {
    const self = this;

    function extractTitle(content: string, filename: string): string {
      const match = content.match(/^#\s+(.+)$/m);
      if (match) return match[1].trim();
      return filename.replace(/\.md$/, '');
    }

    function sanitizeFilename(name: string): string {
      return name.replace(/[<>:"/\\|?*]/g, '_') + '.md';
    }

    function getKnowledgeDirs(): string[] {
      const dirs: string[] = [];
      const projectRoot = self.core.getProjectRoot();
      if (projectRoot) {
        dirs.push(path.join(projectRoot, '.module-agent', 'knowledge'));
      }
      // 全局配置知识目录
      dirs.push(path.join(getUserConfigRoot(), 'config', 'knowledge'));
      return dirs;
    }

    function findKnowledgeFile(filename: string): string | null {
      for (const dir of getKnowledgeDirs()) {
        const filePath = path.join(dir, filename);
        if (fs.existsSync(filePath)) return filePath;
      }
      return null;
    }

    async function readKnowledgeDir(dir: string): Promise<{ name: string; filename: string; source: string }[]> {
      const items: { name: string; filename: string; source: string }[] = [];
      try {
        fs.ensureDirSync(dir);
        const files = await fs.promises.readdir(dir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        for (const file of mdFiles) {
          const filePath = path.join(dir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            items.push({ name: extractTitle(content, file), filename: file, source: dir });
          } catch {
            items.push({ name: file.replace(/\.md$/, ''), filename: file, source: dir });
          }
        }
      } catch { /* 目录可能不存在 */ }
      return items;
    }

    ipcMain.handle('knowledge:list', async () => {
      try {
        const dirs = getKnowledgeDirs();
        const seen = new Set<string>();
        const items: { name: string; filename: string }[] = [];
        for (const dir of dirs) {
          const dirItems = await readKnowledgeDir(dir);
          for (const item of dirItems) {
            if (seen.has(item.filename)) continue;
            seen.add(item.filename);
            items.push({ name: item.name, filename: item.filename });
          }
        }
        items.sort((a, b) => a.name.localeCompare(b.name));
        return items;
      } catch (err) {
        self.logger.error(`knowledge:list failed: ${(err as Error).message}`);
        return [];
      }
    });

    ipcMain.handle('knowledge:read', async (_event, filename: string) => {
      try {
        const filePath = findKnowledgeFile(filename);
        if (!filePath) return null;
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { name: extractTitle(content, filename), filename, content };
      } catch (err) {
        self.logger.error(`knowledge:read failed [${filename}]: ${(err as Error).message}`);
        return null;
      }
    });

    ipcMain.handle('knowledge:save', async (_event, entry: { name: string; filename: string; content: string }) => {
      try {
        // 保存到项目知识目录，回退到第一个可用目录
        const projectRoot = self.core.getProjectRoot();
        if (!projectRoot) return { success: false };
        const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
        fs.ensureDirSync(knowledgeDir);
        const filePath = path.join(knowledgeDir, entry.filename);
        let content = entry.content;
        // 更新第一个 # 标题行匹配 entry.name，或者在最前面添加一个
        if (/^#\s+/m.test(content)) {
          content = content.replace(/^#\s+.*$/m, `# ${entry.name}`);
        } else {
          content = `# ${entry.name}\n\n${content}`;
        }
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { success: true };
      } catch (err) {
        self.logger.error(`knowledge:save failed [${entry.filename}]: ${(err as Error).message}`);
        return { success: false };
      }
    });

    ipcMain.handle('knowledge:create', async (_event, name: string) => {
      try {
        const projectRoot = self.core.getProjectRoot();
        if (!projectRoot) return { error: 'no project root' };
        const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
        fs.ensureDirSync(knowledgeDir);
        const filename = sanitizeFilename(name || '新知识条目');
        const filePath = path.join(knowledgeDir, filename);
        if (fs.existsSync(filePath)) return { error: '文件已存在' };
        const content = `# ${name || '新知识条目'}\n\n`;
        await fs.promises.writeFile(filePath, content, 'utf-8');
        return { name: name || '新知识条目', filename, content };
      } catch (err) {
        self.logger.error(`knowledge:create failed: ${(err as Error).message}`);
        return { error: (err as Error).message };
      }
    });

    ipcMain.handle('knowledge:delete', async (_event, filename: string) => {
      try {
        const projectRoot = self.core.getProjectRoot();
        if (!projectRoot) return { success: false };
        const knowledgeDir = path.join(projectRoot, '.module-agent', 'knowledge');
        const filePath = path.join(knowledgeDir, filename);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          return { success: true };
        }
        return { success: true }; // 文件已不存在
      } catch (err) {
        self.logger.error(`knowledge:delete failed [${filename}]: ${(err as Error).message}`);
        return { success: false };
      }
    });
  }

  // -----------------------------------------------------------------------
  // 工作区 Diff
  // -----------------------------------------------------------------------

  /**
   * 在 Agent session 完成后触发工作区变更检测。
   * 异步执行，不阻塞主流程。
   */
  private _triggerWorkspaceDiff(moduleName: string, workspaceCwd: string, projectRoot: string): void {
    // 根模块 (relativePath === '.') 没有工作区隔离，跳过
    if (!workspaceCwd || !projectRoot) return;

    // 检查 workspaceCwd 是否在 .module-agent/workspace 下
    const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
    if (!workspaceCwd.startsWith(workspaceBase)) return;

    // 从 workspace cwd 反推源目录
    // workspaceCwd = <projectRoot>/.module-agent/workspace/<relativePath>
    const relPath = path.relative(workspaceBase, workspaceCwd);
    const sourceDir = relPath ? path.join(projectRoot, relPath) : projectRoot;

    // 异步执行 diff（不阻塞 agent:send 返回）
    setImmediate(() => {
      try {
        this.logger.info(`WorkspaceDiff: analyzing ${workspaceCwd} vs ${sourceDir}`);
        const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir);
        summary.moduleName = moduleName;
        this.diffCache.set(moduleName, summary);

        if (summary.files.length > 0) {
          this.logger.info(`WorkspaceDiff [${moduleName}]: ${summary.addedCount} added, ${summary.modifiedCount} modified, ${summary.deletedCount} deleted`);
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('workspace:diff-ready', {
            moduleName,
            summary: summary.files.length > 0 ? summary : null,
          });
        }
      } catch (err) {
        this.logger.error(`WorkspaceDiff error [${moduleName}]: ${(err as Error).message}`);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('workspace:diff-ready', {
            moduleName,
            summary: null,
          });
        }
      }
    });
  }

  private _registerWorkspaceDiffHandlers(): void {
    const self = this;

    // 获取模块的完整 diff 摘要
    ipcMain.handle('workspace:diff', async (_event, moduleName: string) => {
      const cached = self.diffCache.get(moduleName);
      if (cached) return cached;

      // 缓存未命中，尝试重新计算
      const entry = self.core.modules.getAgent(moduleName);
      if (!entry) return { error: 'no active agent for this module' };

      const projectRoot = self.core.getProjectRoot();
      if (!projectRoot) return { error: 'no project root' };

      const workspaceCwd = entry.launched.cwd;
      const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
      if (!workspaceCwd.startsWith(workspaceBase)) return { error: 'module has no workspace isolation' };

      const relPath = path.relative(workspaceBase, workspaceCwd);
      const sourceDir = relPath ? path.join(projectRoot, relPath) : projectRoot;

      const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir);
      summary.moduleName = moduleName;
      self.diffCache.set(moduleName, summary);
      return summary;
    });

    // 获取单个文件的统一 diff
    ipcMain.handle('workspace:diff-file', async (_event, moduleName: string, filePath: string) => {
      const cached = self.diffCache.get(moduleName);
      if (!cached) return { error: 'no diff data — call workspace:diff first' };

      const file = cached.files.find(f => f.relativePath === filePath);
      if (!file) return { error: `file not found in diff: ${filePath}` };

      const hunks = WorkspaceDiff.unifiedDiff(file.workspacePath, file.sourcePath);
      return { hunks };
    });

    // 将变更写回源文件
    ipcMain.handle('workspace:apply', async (_event, moduleName: string, files?: string[]) => {
      const cached = self.diffCache.get(moduleName);
      if (!cached) return { applied: 0, errors: ['no diff data'] };

      const result = await WorkspaceDiff.apply(cached.workspaceDir, cached.sourceDir, files, cached.files);
      self.logger.info(`WorkspaceDiff: applied ${result.applied} files for [${moduleName}]`);

      // 重新计算 diff（写回后变更应被清除）
      const newSummary = WorkspaceDiff.analyze(cached.workspaceDir, cached.sourceDir);
      newSummary.moduleName = moduleName;
      self.diffCache.set(moduleName, newSummary);

      return result;
    });

    // 丢弃工作区变更（删除工作区目录）
    ipcMain.handle('workspace:discard', async (_event, moduleName: string) => {
      const cached = self.diffCache.get(moduleName);
      if (cached) {
        await WorkspaceDiff.discardWorkspace(cached.workspaceDir);
        self.diffCache.delete(moduleName);
        self.logger.info(`WorkspaceDiff: discarded workspace for [${moduleName}]`);
      }
      return { success: true };
    });
  }

  private _buildRolePromptBlocks(roleName: string, userText: string) {
    const blocks: { type: 'text'; text: string }[] = [];
    if (this.prompts.rolePrompt) {
      blocks.push({ type: 'text', text: this.prompts.rolePrompt + '\n\n---\n\n' });
    }
    blocks.push({ type: 'text', text: userText });
    return blocks;
  }
}
