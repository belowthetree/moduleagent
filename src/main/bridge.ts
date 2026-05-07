import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type RoleConfig } from '../config/defaults.js';
import { defaultLogger, type Logger } from '../core/Logger.js';
import { AgentStateManager } from '../agents/AgentStateManager.js';
import { McpBackendServer } from '../agents/McpBackend.js';
import { cleanupRoleWorkspace } from '../agents/RoleWorkspace.js';
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
import type { ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../types/module.js';
import type { ChatMsg } from '../types/preload.js';
import type { CoreCallbacks } from '../core/CoreTypes.js';

// ---------------------------------------------------------------------------
// ElectronBridge
// ---------------------------------------------------------------------------

export class ElectronBridge {
  private mainWindow: BrowserWindow;
  private core: ModuleAgentCore;
  private stateManager: AgentStateManager | null = null;
  private mcpBackend: McpBackendServer | null = null;
  private logger: Logger;

  private prompts = { mainPrompt: '', subPrompt: '', rolePrompt: '' };

  // Per-module state (for IPC status reporting)
  private agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
  private sendLock = new Map<string, Promise<void>>();
  private roleSendLock = new Map<string, Promise<void>>();

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logger = defaultLogger;

    const callbacks: CoreCallbacks = this._buildCallbacks();

    this.core = new ModuleAgentCore({
      callbacks,
      basePath: this._getBasePath(),
      logger: this.logger,
      onSessionUpdate: (moduleName, sessionId, notification) => {
        // Forward to AgentStateManager for accumulation
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
            sections: acc?.sections,
          });
        }
      },
    });
  }

  // -----------------------------------------------------------------------
  // IPC registration
  // -----------------------------------------------------------------------

  registerAllHandlers(): void {
    this._registerDialogHandlers();
    this._registerProjectHandlers();
    this._registerAgentHandlers();
    this._registerContextHandlers();
    this._registerConfigHandlers();
    this._registerRoleHandlers();
    this._registerMigrationHandlers();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  async cleanup(): Promise<void> {
    await this.core.dispose();
    try { this.mcpBackend?.stop(); } catch { /* ignore */ }
    if (this.core.modules.mcpGraphFile) {
      try { fs.unlinkSync(this.core.modules.mcpGraphFile); } catch { /* ignore */ }
    }
  }

  // -----------------------------------------------------------------------
  // Private: callbacks
  // -----------------------------------------------------------------------

  private _buildCallbacks(): CoreCallbacks {
    const send = (channel: string, data: unknown) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    };

    return {
      onStreamChunk: () => { /* handled via onSessionUpdate */ },
      onStreamComplete: () => { /* handled via onSessionUpdate */ },
      onStreamError: (moduleName, error) => {
        this.agentStatus.set(moduleName, 'error');
        send('agent:status', { name: moduleName, status: 'error' });
        this.logger.error(`[${moduleName}] stream error: ${error}`);
      },
      onStatusChange: () => { /* status managed per-module */ },
      onMessage: () => { /* messages handled via per-module streams */ },
    };
  }

  private _getBasePath(): string {
    // app.getAppPath() returns the Electron app root
    try {
      const { app } = require('electron');
      return app.getAppPath();
    } catch {
      return process.cwd();
    }
  }

  // -----------------------------------------------------------------------
  // Private: IPC handler registration
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
        const config = ConfigLoader.getDefaultConfig(workspaceConfig);

        const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
        fs.mkdirSync(moduleScanPath, { recursive: true });
        const descriptors = await ModuleScanner.scan({
          projectRoot: moduleScanPath,
          extraExclude: config.exclude,
        });

        const graph = new ModuleGraph().build(descriptors, projectRoot);
        const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

        // Load prompts
        const basePath = self._getBasePath();
        self.prompts = { ...loadSystemPrompts(basePath), rolePrompt: '' };
        try {
          const rpPath = path.join(basePath, 'config', 'roleagentprompt.md');
          self.prompts.rolePrompt = fs.readFileSync(rpPath, 'utf-8');
        } catch { /* optional */ }

        // Init core
        const result = await self.core.init(projectRoot);

        // Set MCP backend port on core.modules
        self.core.modules.mcpBackendPort = 0; // Will be set after backend starts
        self.core.modules.mcpGraphFile = writeMcpGraphFile(graph, os.tmpdir());

        // Init state manager
        self.stateManager = new AgentStateManager(
          path.join(projectRoot, '.module-agent', 'context'),
        );

        // Init role subsystem
        self.core.initRoles(config.projectPath, workspaceRoot);

        // Create MCP backend
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
      function buildTree(node: ModuleGraphNode): Record<string, unknown> {
        return {
          name: node.name,
          path: node.relativePath,
          description: node.definition.frontmatter.description,
          children: node.children
            .map(c => graph!.nodes.get(c))
            .filter(Boolean)
            .map(c => buildTree(c!)),
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
        if (rootNode.relativePath !== '.') {
          cwd = await prepareModuleWorkspace(rootNode, {
            workspaceRoot,
            projectPath: config.projectPath,
            graph,
          });
        } else {
          cwd = rootNode.absolutePath;
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
        try { fs.unlinkSync(graphFile); } catch { /* ignore */ }

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
        try { await prevLock; } catch { /* proceed */ }
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

        // Save context
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
          time: timeStr,
          status: 'completed',
          moduleName,
        };
        const existingMsgs = await self.stateManager?.loadContext(moduleName) ?? [];
        existingMsgs.push(userMsg, agentMsg);
        await self.stateManager?.saveContext(moduleName, existingMsgs);

        self.agentStatus.set(moduleName, 'idle');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });

        return {
          result: {
            reply: acc?.reply || '',
            thinking: acc?.thinking || '',
            tools: acc?.tools || '',
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
        try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* ignore */ }
        self.agentStatus.set(moduleName, 'idle');
        self.mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });
      }
      const acc = self.stateManager?.cancelStream(moduleName);
      return { accumulated: acc };
    });

    ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
      const entry = self.core.modules.getAgent(moduleName);
      if (entry) {
        try { entry.launched.process.kill(); } catch { /* ignore */ }
        // Remove from agents map directly via internal access
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
    ipcMain.handle('config:save', async (_event, projectRoot: string, updates: { command?: string; args?: string[]; projectPath?: string }) => {
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
        };
      } catch {
        return {
          command: DEFAULT_CONFIG.agents.default.command,
          args: DEFAULT_CONFIG.agents.default.args || [],
          projectPath: DEFAULT_CONFIG.projectPath,
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
      if (prevLock) try { await prevLock; } catch { /* proceed */ }
      let resolveLock: () => void = () => {};
      const lockPromise = new Promise<void>(r => { resolveLock = r; });
      self.roleSendLock.set(roleName, lockPromise);

      try {
        let entry = self.core.roles.getAgent(roleName);
        if (!entry) {
          const workspaceConfig = await ConfigLoader.load(self.core.getProjectRoot());
          const role = workspaceConfig.roles?.find(r => r.name === roleName);
          if (!role) return { error: `role not found: ${roleName}` };
          entry = await self.core.roles.startRole(role);
        }

        const ctxKey = `workrole:${roleName}`;
        self.stateManager?.startStream(ctxKey);

        self.logger.info(`role:send [${roleName}] len=${text.length}`);
        const result = await entry.launched.connection.prompt({
          sessionId: entry.sessionId,
          prompt: self._buildRolePromptBlocks(roleName, text),
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
        try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* ignore */ }
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

  private _buildRolePromptBlocks(roleName: string, userText: string) {
    const blocks: { type: 'text'; text: string }[] = [];
    if (this.prompts.rolePrompt) {
      blocks.push({ type: 'text', text: this.prompts.rolePrompt + '\n\n---\n\n' });
    }
    blocks.push({ type: 'text', text: userText });
    return blocks;
  }
}
