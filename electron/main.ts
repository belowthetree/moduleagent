import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { context as esbuildContext } from 'esbuild';
import { ModuleScanner } from '../src/core/ModuleScanner.js';
import { ModuleGraph } from '../src/core/ModuleGraph.js';
import { ConfigLoader } from '../src/config/ConfigLoader.js';
import { Logger, LogLevel, defaultLogger } from '../src/core/Logger.js';
import { AgentLauncher } from '../src/agents/AgentLauncher.js';
import { ACPClient } from '../src/protocol/acp/ACPClient.js';
import type { ModuleGraphNode } from '../src/types/module.js';

const logsDir = path.join(app.getPath('userData'), 'logs');
defaultLogger.configure(logsDir, LogLevel.INFO);
defaultLogger.info('ModuleAgent starting...');

let mainWindow: BrowserWindow | null = null;
let currentGraph: ReturnType<ModuleGraph['build']> | null = null;
let currentProjectRoot = '';

const agents = new Map<string, { client: ACPClient; sessionId: string; config: { command: string; args?: string[] } }>();
const launcher = new AgentLauncher();

function getResourcePath(...segments: string[]): string {
  return path.join(app.getAppPath(), ...segments);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'ModuleAgent',
    webPreferences: {
      preload: getResourcePath('electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(getResourcePath('electron', 'renderer', 'index.html'));
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
      const config = await ConfigLoader.loadOrCreate(projectRoot);
      const descriptors = await ModuleScanner.scan({ projectRoot, extraExclude: config.exclude });
      const graph = new ModuleGraph().build(descriptors, projectRoot);
      currentGraph = graph;
      currentProjectRoot = projectRoot;
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
        source: node.definition.frontmatter.source || null,
        children: node.children.map(c => currentGraph!.nodes.get(c)).filter(Boolean).map(c => buildTree(c!)),
      };
    }
    const rootNode = currentGraph.nodes.get(currentGraph.root);
    return rootNode ? buildTree(rootNode) : null;
  });

  // ── Agent IPC ──
  ipcMain.handle('agent:start', async (_event, moduleName: string, cmd: string, cwd: string) => {
    if (agents.has(moduleName)) {
      const a = agents.get(moduleName)!;
      return { sessionId: a.sessionId };
    }

    try {
      defaultLogger.info(`agent:start [${moduleName}] cmd=${cmd} cwd=${cwd}`);
      const launched = await launcher.launch({ command: cmd }, moduleName, cwd, defaultLogger);
      const sessionId = await launched.client.createSession(cwd);

      const entry = { client: launched.client, sessionId, config: { command: cmd } };
      agents.set(moduleName, entry);

      // Forward session/update stream to renderer
      const session = launched.client.getSession(sessionId);
      if (session) {
        session.handlers = {
          ...session.handlers,
          onUpdate: (_sid, update) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('agent:stream', {
                moduleName, sessionId,
                update: update.sessionUpdate,
                data: update,
              });
            }
          },
        };
      }

      return { sessionId };
    } catch (err) {
      defaultLogger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:send', async (_event, moduleName: string, text: string) => {
    let entry = agents.get(moduleName);
    if (!entry) return { error: 'agent not started' };

    try {
      defaultLogger.session(entry.sessionId, 'prompt', `len=${text.length}`);
      const result = await entry.client.prompt(entry.sessionId, text);
      return { stopReason: result.stopReason };
    } catch (err) {
      defaultLogger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
      // If agent died, clean up
      agents.delete(moduleName);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
    const entry = agents.get(moduleName);
    if (entry) {
      try { await entry.client.stop(); } catch {}
      agents.delete(moduleName);
      defaultLogger.info(`agent:stop [${moduleName}]`);
    }
    return {};
  });

  ipcMain.handle('agent:isRunning', (_event, moduleName: string) => {
    return agents.has(moduleName);
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();
  setupDevHotReload();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function setupDevHotReload() {
  const srcDir = getResourcePath('electron', 'renderer');
  const entryFile = path.join(srcDir, 'renderer.ts');
  const outFile = path.join(srcDir, 'renderer.js');
  try {
    const ctx = await esbuildContext({
      entryPoints: [entryFile], outfile: outFile,
      bundle: true, platform: 'browser', format: 'iife',
    });
    await ctx.watch();
    fs.watch(srcDir, { recursive: true }, (_event, filename) => {
      if (filename && (filename.endsWith('.css') || filename.endsWith('.html'))) debounceReload();
    });
    fs.watch(outFile, () => debounceReload());
  } catch (err) { console.error('[dev] esbuild watch failed:', err); }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function debounceReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { if (mainWindow) mainWindow.webContents.reload(); }, 200);
}

app.on('window-all-closed', () => {
  for (const [, entry] of agents) { try { entry.client.stop(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});
