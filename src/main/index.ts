import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { ModuleScanner } from '../core/ModuleScanner.js';
import { ModuleGraph } from '../core/ModuleGraph.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../config/defaults.js';
import { Logger, LogLevel, defaultLogger } from '../core/Logger.js';
import { AgentLauncher } from '../agents/AgentLauncher.js';
import { AgentOrchestrator } from '../agents/AgentOrchestrator.js';
import { AgentStateManager } from '../agents/AgentStateManager.js';
import { McpBackendServer } from '../agents/McpBackend.js';
import {
  workspacePathForModule,
  codeSourcePathForModule,
  getSubModuleDirs,
  prepareModuleWorkspace,
} from '../agents/WorkspaceIsolator.js';
import {
  loadSystemPrompts,
  buildPromptBlocks,
  dedupMessage,
} from '../agents/PromptBuilder.js';
import {
  buildMcpServers,
  writeMcpGraphFile,
} from '../agents/McpServerBuilder.js';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { ChatMsg } from '../types/preload.js';

defaultLogger.configure('logs', LogLevel.INFO);
defaultLogger.info('ModuleAgent starting...');

let mainWindow: BrowserWindow | null = null;
let currentGraph: ModuleGraphType | null = null;
let currentProjectRoot = '';
let currentWorkspaceRoot = '';

const agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
const lastSent = new Map<string, { text: string; time: number }>();
const sessionPrompted = new Set<string>();
const launcher = new AgentLauncher();

// MCP backend state
let mcpBackendPort = 0;
let mcpGraphFile = '';

let prompts = { mainPrompt: '', subPrompt: '' };
let orchestrator: AgentOrchestrator | null = null;
let stateManager: AgentStateManager | null = null;
const sendLock = new Map<string, Promise<void>>();
let mcpBackend: McpBackendServer | null = null;

function createWindow() {
  console.log('[main] Creating window...');
  console.log('[main] __dirname:', __dirname);
  console.log('[main] preload path:', path.join(__dirname, '../preload/index.cjs'));
  console.log('[main] ELECTRON_RENDERER_URL:', process.env.ELECTRON_RENDERER_URL || '(not set - production mode)');
  console.log('[main] loadFile path:', path.join(__dirname, '../renderer/index.html'));
  console.log('[main] app.getAppPath():', app.getAppPath());

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'ModuleAgent',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // Open DevTools only in dev mode (ELECTRON_RENDERER_URL is set)
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[main] FAILED TO LOAD:', code, desc, url);
  });

  mainWindow.webContents.on('console-message', (_event, level, msg) => {
    console.log('[renderer console]', msg);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    console.log('[main] Loading URL:', process.env.ELECTRON_RENDERER_URL);
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    console.log('[main] Loading file:', path.join(__dirname, '../renderer/index.html'));
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  mainWindow.once('ready-to-show', () => mainWindow?.show());
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:selectDir', async (_event, title: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('project:scan', async (_event, projectRoot: string, workspaceRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.loadOrCreate(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);

      // Only scan .module-agent/module/ — the definitive location for all module.md files
      const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
      fs.mkdirSync(moduleScanPath, { recursive: true });
      const descriptors = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });

      const graph = new ModuleGraph().build(descriptors, projectRoot);
      currentGraph = graph;
      currentProjectRoot = projectRoot;
      currentWorkspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

      prompts = loadSystemPrompts(app.getAppPath());
      mcpGraphFile = writeMcpGraphFile(graph);

      stateManager = new AgentStateManager(path.join(projectRoot, '.module-agent', 'context'));

      orchestrator = new AgentOrchestrator({
        launcher,
        workspaceIsolator: {
          workspacePathForModule,
          codeSourcePathForModule,
          getSubModuleDirs,
          prepareModuleWorkspace,
        },
        promptBuilder: { buildPromptBlocks },
        mcpServerBuilder: { buildMcpServers, writeMcpGraphFile },
        basePath: app.getAppPath(),
        projectRoot,
        workspaceRoot: currentWorkspaceRoot,
        projectPath: config.projectPath,
        graph,
        sessionPrompted,
        lastSent,
        callbacks: {
          onSessionUpdate(name, sessionId, notification) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              stateManager?.appendChunk(name, notification.update.sessionUpdate, notification.update);
              const acc = stateManager?.getStreamState(name);
              mainWindow.webContents.send('agent:stream', {
                moduleName: name,
                sessionId,
                update: notification.update.sessionUpdate,
                data: notification.update,
                reply: acc?.reply,
                thinking: acc?.thinking,
                tools: acc?.tools,
                sections: acc?.sections,
              });
            }
          },
          sendCrossContext(source, target, direction, phase, content) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('agent:cross-context', {
                moduleName: source,
                crossModule: target,
                direction,
                phase,
                content,
                time: new Date().toLocaleTimeString(),
              });
            }
          },
        },
      });

      mcpBackend = new McpBackendServer({
        getAgentEntry(name) {
          const e = orchestrator?.getAgent(name);
          return e ? { launched: e.launched, sessionId: e.sessionId } : undefined;
        },
        startAgent(name) {
          return orchestrator!.startAgent({ moduleName: name })
            .then(() => true)
            .catch((err) => {
              defaultLogger.error(`MCP: failed to auto-start agent for ${name}: ${(err as Error).message}`);
              return false;
            });
        },
        buildPromptBlocks(name, text) {
          return buildPromptBlocks({
            moduleName: name,
            userText: text,
            graph: currentGraph!,
            prompts,
            sessionPrompted,
          });
        },
        sendCrossContext(source, target, direction, phase, content) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent:cross-context', {
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
          agentStatus.set(name, status);
          mainWindow?.webContents.send('agent:status', { name, status });
        },
        onLog(level, message) {
          if (level === 'error') defaultLogger.error(message);
          else if (level === 'warn') defaultLogger.warn(message);
          else defaultLogger.info(message);
        },
      });

      const port = await mcpBackend.start();
      mcpBackendPort = port;

      orchestrator.mcpBackendPort = port;
      orchestrator.mcpGraphFile = mcpGraphFile;

      defaultLogger.info(`MCP setup complete: graph=${mcpGraphFile} port=${mcpBackendPort}`);

      const nodes: Record<string, ModuleGraphNode> = {};
      for (const [name, node] of graph.nodes) nodes[name] = { ...node, workspacePath: currentWorkspaceRoot };
      return { root: graph.root, nodes, moduleCount: descriptors.length };
    } catch (err) { return { error: (err as Error).message }; }
  });

  ipcMain.handle('project:getTree', () => {
    if (!currentGraph) return null;
    function buildTree(node: ModuleGraphNode): Record<string, unknown> {
      return {
        name: node.name, path: node.relativePath,
        description: node.definition.frontmatter.description,
        children: node.children.map(c => currentGraph!.nodes.get(c)).filter(Boolean).map(c => buildTree(c!)),
      };
    }
    const rootNode = currentGraph.nodes.get(currentGraph.root);
    return rootNode ? buildTree(rootNode) : null;
  });

  ipcMain.handle('project:generateModules', async (_event, projectRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.loadOrCreate(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);

      // 1. Create minimal root module.md so graph has a root node
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

      // 2. Scan .module-agent/module/ → build graph
      const descriptors = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });
      const graph = new ModuleGraph().build(descriptors, projectRoot);

      const rootNode = graph.nodes.get(graph.root);
      if (!rootNode) {
        return { success: false, count: 0, error: 'No root module found after scan' };
      }

      // 3. Resolve agent config (module-specific > default)
      let agentCommand = config.agents.default.command;
      let agentArgs = config.agents.default.args || [];
      const modules = config.agents.modules;
      if (modules && modules[rootNode.name]) {
        agentCommand = modules[rootNode.name]!.command;
        agentArgs = modules[rootNode.name]!.args;
      }

      // 4. Prepare workspace + submodule dirs
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

      // 5. Launch agent + create session
      const launched = await launcher.launch(
        { command: agentCommand, args: agentArgs },
        rootNode.name,
        cwd,
        defaultLogger,
        { subModuleDirs },
      );

      const graphFile = writeMcpGraphFile(graph);
      const mcpServers = buildMcpServers({
        moduleName: rootNode.name,
        basePath: app.getAppPath(),
        graphFile,
      });

      const { sessionId } = await launched.connection.newSession({
        cwd,
        mcpServers,
      });

      // 6. Send generation prompt
      const projectName = path.basename(projectRoot);
      const dirs = mainDescriptors
        .map((d) => path.relative(projectRoot, path.dirname(d.moduleMdPath)))
        .filter(Boolean);

      const systemBlock = {
        type: 'text' as const,
        text: `You are a module documentation expert. Your task is to analyze source code directories and generate comprehensive module.md files.

Each module.md must have YAML frontmatter with:
- name: module name — use the relative path from project root (e.g., "src/utils" not just "utils") to ensure uniqueness
- description: what this module does (inferred from source code)
- submodules: child modules (name, path, description) — the "name" must match the child module's frontmatter name exactly

The body must include:
- Module purpose and role
- Public API / exports
- Key dependencies
- Usage examples
- Architecture notes

Write each module.md to: ${moduleScanPath}/<relative-path>/module.md
Use the file_access tool to create directories and write files.

DO NOT overwrite existing module.md files.`,
      };

      const dirsList =
        dirs.length > 0
          ? dirs.map((d) => `  - ${d}`).join('\n')
          : '  (root module only)';

      const userBlock = {
        type: 'text' as const,
        text: `Project: ${projectName}
Project root: ${projectRoot}

Please analyze the following source directories and generate module.md for each one:

${dirsList}

For each directory:
1. Read the source files to understand what the module does
2. Generate a comprehensive module.md with API docs, dependencies, usage
3. Write it to ${moduleScanPath}/<relative-path>/module.md
4. Include proper submodule references for child directories

Start with the root module, then work through each sub-module.`,
      };

      const prompt = [systemBlock, userBlock];

      const result = await launched.connection.prompt({ sessionId, prompt });
      defaultLogger.info(`[generateModules] Agent completed. stopReason=${result.stopReason}`);

      try { fs.unlinkSync(graphFile); } catch {}

      // 7. Rescan to discover newly generated modules
      const newDescriptors = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });
      const newSeen = new Set(newDescriptors.map((d) => d.moduleMdPath));
      const totalCount = newSeen.size;

      defaultLogger.info(`[generateModules] Done. Total modules: ${totalCount}`);
      return { success: true, count: totalCount };
    } catch (err) {
      defaultLogger.error(`[generateModules] Error: ${(err as Error).message}`);
      return { success: false, count: 0, error: (err as Error).message };
    }
  });

  // ── Agent IPC ──
  ipcMain.handle('agent:start', async (_event, moduleName: string, _cmd: string, _args: string[], _cwd: string) => {
    if (!orchestrator) return { error: 'no module graph loaded' };

    const existing = orchestrator.getAgent(moduleName);
    if (existing) return { sessionId: existing.sessionId };

    try {
      const entry = await orchestrator.startAgent({ moduleName });
      return { sessionId: entry.sessionId };
    } catch (err) {
      defaultLogger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      agentStatus.set(moduleName, 'error');
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'error' });
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:send', async (_event, moduleName: string, text: string, _cwd?: string) => {
    if (!orchestrator) return { error: 'no module graph loaded' };

    if (dedupMessage(lastSent, moduleName, text)) {
      return { error: 'duplicate message ignored' };
    }

    // Per-module sending mutex
    const prevLock = sendLock.get(moduleName);
    if (prevLock) {
      try { await prevLock; } catch { /* previous send failed, proceed */ }
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    sendLock.set(moduleName, lockPromise);

    try {
      // Auto-start agent if not running
      let entry = orchestrator.getAgent(moduleName);
      if (!entry) {
        const startResult = await orchestrator.startAgent({ moduleName });
        entry = startResult;
      }

      agentStatus.set(moduleName, 'streaming');
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'streaming' });

      const promptBlocks = buildPromptBlocks({
        moduleName,
        userText: text,
        graph: currentGraph!,
        prompts,
        sessionPrompted,
      });

      stateManager?.startStream(moduleName);

      defaultLogger.session(entry.sessionId, 'prompt', `len=${text.length} blocks=${promptBlocks.length}`);
      const result = await entry.launched.connection.prompt({
        sessionId: entry.sessionId,
        prompt: promptBlocks,
      });

      const acc = stateManager?.finishStream(moduleName);

      // Save context to disk
      const timeStr = new Date().toLocaleTimeString();
      const agentCmd = entry.config.command || '';
      const userMsg: ChatMsg = {
        id: 'm' + Date.now().toString(36),
        role: 'user',
        content: text,
        thinking: '',
        tools: '',
        time: timeStr,
        status: 'sent',
        moduleName,
        agentCmd,
      };
      const agentMsg: ChatMsg = {
        id: 'm' + (Date.now() + 1).toString(36),
        role: 'agent',
        content: acc?.reply || '',
        thinking: acc?.thinking || '',
        tools: acc?.tools || '',
        time: timeStr,
        status: 'completed',
        moduleName,
        agentCmd,
      };
      const existingMsgs = await stateManager?.loadContext(moduleName) ?? [];
      existingMsgs.push(userMsg, agentMsg);
      await stateManager?.saveContext(moduleName, existingMsgs);

      agentStatus.set(moduleName, 'idle');
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });

      return {
        result: {
          reply: acc?.reply || '',
          thinking: acc?.thinking || '',
          tools: acc?.tools || '',
          stopReason: result.stopReason,
        },
      };
    } catch (err) {
      defaultLogger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
      stateManager?.stopStream(moduleName);
      agentStatus.set(moduleName, 'error');
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'error' });
      return { error: (err as Error).message };
    } finally {
      resolveLock();
      sendLock.delete(moduleName);
    }
  });

  ipcMain.handle('agent:cancel', async (_event, moduleName: string) => {
    const entry = orchestrator?.getAgent(moduleName);
    if (entry) {
      try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch {}
      agentStatus.set(moduleName, 'idle');
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'idle' });
      defaultLogger.info(`agent:cancel [${moduleName}]`);
    }
    const acc = stateManager?.cancelStream(moduleName);
    return { accumulated: acc };
  });

  ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
    const entry = orchestrator?.getAgent(moduleName);
    if (entry) {
      try { entry.launched.process.kill(); } catch {}
      orchestrator!.agents.delete(moduleName);
      agentStatus.delete(moduleName);
      mainWindow?.webContents.send('agent:status', { name: moduleName, status: 'stopped' });
      sessionPrompted.delete(moduleName);
      defaultLogger.info(`agent:stop [${moduleName}]`);
    }
    stateManager?.stopStream(moduleName);
    return {};
  });

  ipcMain.handle('agent:isRunning', (_event, moduleName: string) => {
    return orchestrator?.getAgent(moduleName) !== undefined;
  });

  ipcMain.handle('agent:getRunning', () => {
    return (orchestrator?.listAgents() || []).map(name => ({
      name,
      status: agentStatus.get(name) || 'idle',
    }));
  });

  // ── Context IPC ──
  ipcMain.handle('context:get', async (_event, moduleName: string) => {
    return stateManager?.loadContext(moduleName) ?? [];
  });

  ipcMain.handle('context:clear', async (_event, moduleName: string) => {
    await stateManager?.clearContext(moduleName);
  });

  ipcMain.handle('context:clearAll', async () => {
    await stateManager?.clearAllContexts();
  });

  // ── localStorage Migration IPC ──
  ipcMain.handle('migrate:check', async (_event, keys: string[]) => {
    if (!stateManager) return { needed: [], streamNeeded: false };
    const needed: string[] = [];
    for (const key of keys) {
      if (key.startsWith('ctx_')) {
        const moduleName = key.slice(4);
        const existing = await stateManager.loadContext(moduleName);
        if (existing.length === 0) needed.push(key);
      }
    }
    const streamNeeded = keys.includes('stream_snapshot');
    return { needed, streamNeeded };
  });

  ipcMain.handle('migrate:data', async (_event, payload: { moduleName: string; msgs: ChatMsg[] }) => {
    if (!stateManager) return;
    await stateManager.saveContext(payload.moduleName, payload.msgs);
  });

  // ── Config IPC ──
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
    defaultLogger.info(`config:save wrote to ${configPath}`);
    return { success: true };
  });

  ipcMain.handle('config:get', async (_event, projectRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      return { command: config.agents.default.command, args: config.agents.default.args || [], projectPath: config.projectPath };
    } catch {
      return { command: DEFAULT_CONFIG.agents.default.command, args: DEFAULT_CONFIG.agents.default.args || [], projectPath: DEFAULT_CONFIG.projectPath };
    }
  });
}

app.whenReady().then(() => {
  console.log('[main] App ready, __dirname:', __dirname);
  console.log('[main] app.getAppPath():', app.getAppPath());
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (orchestrator) {
    orchestrator.stopAll().catch(() => {});
  }
  try { mcpBackend?.stop(); } catch {}
  if (mcpGraphFile) { try { fs.unlinkSync(mcpGraphFile); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});
