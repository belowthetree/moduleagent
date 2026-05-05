import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { ModuleScanner } from '../core/ModuleScanner.js';
import { ModuleGraph } from '../core/ModuleGraph.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../config/defaults.js';
import { Logger, LogLevel, defaultLogger } from '../core/Logger.js';
import { normalizeCodeSourcePath } from '../core/PathUtils.js';
import { AgentLauncher } from '../agents/AgentLauncher.js';
import { AgentOrchestrator } from '../agents/AgentOrchestrator.js';
import { McpBackendServer } from '../agents/McpBackend.js';
import {
  workspacePathForModule,
  codeSourcePathForModule,
  getSubModuleDirs,
  prepareModuleWorkspace,
  resolveGitCodeSource,
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

defaultLogger.configure('logs', LogLevel.INFO);
defaultLogger.info('ModuleAgent starting...');

let mainWindow: BrowserWindow | null = null;
let currentGraph: ModuleGraphType | null = null;
let currentProjectRoot = '';
let currentWorkspaceRoot = '';
let currentCodeSource: { type: 'git' | 'local'; url?: string; branch?: string; path?: string } | null = null;

const agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
const lastSent = new Map<string, { text: string; time: number }>();
const sessionPrompted = new Set<string>();
const launcher = new AgentLauncher();

// MCP backend state
let mcpBackendPort = 0;
let mcpGraphFile = '';

let prompts = { mainPrompt: '', subPrompt: '' };
let orchestrator: AgentOrchestrator | null = null;
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
      const descriptors = await ModuleScanner.scan({ projectRoot, extraExclude: config.exclude });

      // Also scan modulesPath (or fallback to codeSource.path) for additional modules
      const moduleScanPath = config.modulesPath
        ? normalizeCodeSourcePath(config.modulesPath)
        : config.codeSource.type === 'local' && config.codeSource.path
          ? normalizeCodeSourcePath(config.codeSource.path)
          : '';
      if (moduleScanPath && moduleScanPath !== path.resolve(projectRoot)) {
        try {
          const extraDesc = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });
          const seen = new Set(descriptors.map((d) => d.moduleMdPath));
          for (const d of extraDesc) {
            if (!seen.has(d.moduleMdPath)) descriptors.push(d);
          }
          defaultLogger.info(`project:scan found ${extraDesc.length} extra modules in ${moduleScanPath}`);
        } catch (err) {
          defaultLogger.warn(`project:scan failed to scan modulesPath ${moduleScanPath}: ${(err as Error).message}`);
        }
      }

      const graph = new ModuleGraph().build(descriptors, projectRoot);
      currentGraph = graph;
      currentProjectRoot = projectRoot;
      currentWorkspaceRoot = workspaceRoot;
      currentCodeSource = config.codeSource || null;

      prompts = loadSystemPrompts(app.getAppPath());
      mcpGraphFile = writeMcpGraphFile(graph);

      orchestrator = new AgentOrchestrator({
        launcher,
        workspaceIsolator: {
          workspacePathForModule,
          codeSourcePathForModule,
          getSubModuleDirs,
          prepareModuleWorkspace,
          resolveGitCodeSource,
        },
        promptBuilder: { buildPromptBlocks },
        mcpServerBuilder: { buildMcpServers, writeMcpGraphFile },
        basePath: app.getAppPath(),
        projectRoot,
        workspaceRoot,
        codeSource: config.codeSource || null,
        graph,
        sessionPrompted,
        lastSent,
        callbacks: {
          onSessionUpdate(name, sessionId, notification) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('agent:stream', {
                moduleName: name,
                sessionId,
                update: notification.update.sessionUpdate,
                data: notification.update,
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
      for (const [name, node] of graph.nodes) nodes[name] = { ...node, workspacePath: workspaceRoot };
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
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:send', async (_event, moduleName: string, text: string) => {
    const entry = orchestrator?.getAgent(moduleName);
    if (!entry) return { error: 'agent not started' };

    if (dedupMessage(lastSent, moduleName, text)) {
      return { error: 'duplicate message ignored' };
    }

    try {
      agentStatus.set(moduleName, 'streaming');
      const promptBlocks = buildPromptBlocks({
        moduleName,
        userText: text,
        graph: currentGraph!,
        prompts,
        sessionPrompted,
      });
      defaultLogger.session(entry.sessionId, 'prompt', `len=${text.length} blocks=${promptBlocks.length}`);
      const result = await entry.launched.connection.prompt({
        sessionId: entry.sessionId,
        prompt: promptBlocks,
      });
      agentStatus.set(moduleName, 'idle');
      return { stopReason: result.stopReason };
    } catch (err) {
      defaultLogger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
      agentStatus.set(moduleName, 'error');
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:cancel', async (_event, moduleName: string) => {
    const entry = orchestrator?.getAgent(moduleName);
    if (entry) {
      try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch {}
      agentStatus.set(moduleName, 'idle');
      defaultLogger.info(`agent:cancel [${moduleName}]`);
    }
    return {};
  });

  ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
    const entry = orchestrator?.getAgent(moduleName);
    if (entry) {
      try { entry.launched.process.kill(); } catch {}
      orchestrator!.agents.delete(moduleName);
      agentStatus.delete(moduleName);
      sessionPrompted.delete(moduleName);
      defaultLogger.info(`agent:stop [${moduleName}]`);
    }
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

  // ── Config IPC ──
  ipcMain.handle('config:save', async (_event, projectRoot: string, updates: { command?: string; args?: string[]; codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string }; modulesPath?: string }) => {
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
    if (updates.codeSource) config.codeSource = updates.codeSource;
    if (updates.modulesPath !== undefined) config.modulesPath = updates.modulesPath;
    await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
    defaultLogger.info(`config:save wrote to ${configPath}`);
    return { success: true };
  });

  ipcMain.handle('config:get', async (_event, projectRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      return { command: config.agents.default.command, args: config.agents.default.args || [], codeSource: config.codeSource, modulesPath: config.modulesPath };
    } catch {
      return { command: DEFAULT_CONFIG.agents.default.command, args: DEFAULT_CONFIG.agents.default.args || [], codeSource: DEFAULT_CONFIG.codeSource, modulesPath: DEFAULT_CONFIG.modulesPath };
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
