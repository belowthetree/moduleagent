import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'node:http';
import os from 'os';
import { context as esbuildContext } from 'esbuild';
import { ModuleScanner } from '../src/core/ModuleScanner.js';
import { ModuleGraph } from '../src/core/ModuleGraph.js';
import { ConfigLoader } from '../src/config/ConfigLoader.js';
import { Logger, LogLevel, defaultLogger } from '../src/core/Logger.js';
import { AgentLauncher, type LaunchedAgent } from '../src/agents/AgentLauncher.js';
import type { ClientSideConnection, SessionNotification, ContentBlock, McpServer } from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../src/types/module.js';

defaultLogger.configure('logs', LogLevel.INFO);
defaultLogger.info('ModuleAgent starting...');

let mainWindow: BrowserWindow | null = null;
let currentGraph: ModuleGraphType | null = null;
let currentProjectRoot = '';

interface AgentEntry {
  connection: ClientSideConnection;
  process: ChildProcess;
  sessionId: string;
  config: { command: string; args?: string[] };
  launched: LaunchedAgent;
}
const agents = new Map<string, AgentEntry>();
const lastSent = new Map<string, { text: string; time: number }>();
const sessionPrompted = new Set<string>();
const launcher = new AgentLauncher();

// MCP backend state
let mcpBackendPort = 0;
let mcpGraphFile = '';
let mcpBackendServer: http.Server | null = null;

// Cached system prompts
let cachedMainPrompt = '';
let cachedSubPrompt = '';

function loadSystemPrompts() {
  const mainPath = path.join(currentProjectRoot, 'mainagentprompt.md');
  const subPath = path.join(currentProjectRoot, 'subagentprompt.md');
  try { cachedMainPrompt = fs.readFileSync(mainPath, 'utf-8'); } catch { cachedMainPrompt = ''; }
  try { cachedSubPrompt = fs.readFileSync(subPath, 'utf-8'); } catch { cachedSubPrompt = ''; }
  if (cachedMainPrompt) defaultLogger.info(`Loaded main agent prompt (${cachedMainPrompt.length} chars)`);
  if (cachedSubPrompt) defaultLogger.info(`Loaded sub-agent prompt (${cachedSubPrompt.length} chars)`);
}

function buildPromptBlocks(moduleName: string, userText: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const isFirst = !sessionPrompted.has(moduleName);

  if (isFirst) {
    sessionPrompted.add(moduleName);

    // System prompt
    const systemPrompt = moduleName === 'main' ? cachedMainPrompt : cachedSubPrompt;
    if (systemPrompt) {
      blocks.push({ type: 'text', text: systemPrompt + '\n\n---\n\n' });
    }

    // Module context (module.md content)
    const node = currentGraph?.nodes.get(moduleName);
    if (node?.definition?.body) {
      blocks.push({ type: 'text', text: `# Module: ${moduleName}\n\n${node.definition.body}\n\n---\n\n` });
    }
  }

  blocks.push({ type: 'text', text: userText });
  return blocks;
}

function startMcpBackend(): Promise<number> {
  if (mcpBackendServer) return Promise.resolve(mcpBackendPort);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method !== 'POST') {
        res.writeHead(405); res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        try {
          const msg = JSON.parse(body) as { targetModule?: string; task?: string; query?: string; requestingModule?: string };
          const targetModule = msg.targetModule;
          if (!targetModule) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: 'Missing targetModule' }));
            return;
          }

          // Auto-start agent if not running
          if (!agents.has(targetModule)) {
            const started = await ensureModuleAgentRunning(targetModule);
            if (!started) {
              res.writeHead(404);
              res.end(JSON.stringify({ success: false, error: `Cannot start agent for module: ${targetModule}` }));
              return;
            }
          }

          const entry = agents.get(targetModule)!;
          const promptText = msg.task
            ? `[Cross-module request] ${msg.task}`
            : `[Cross-module query] ${msg.query}`;

          const chunks: string[] = [];
          const prevHandler = entry.launched.onSessionUpdate;
          entry.launched.onSessionUpdate = (name, sid, notification) => {
            prevHandler?.(name, sid, notification);
            if (sid === entry.sessionId) {
              const u = notification.update;
              if (u.sessionUpdate === 'agent_message_chunk') {
                const block = (u as { content?: { type?: string; text?: string } }).content;
                if (block?.type === 'text' && block.text) chunks.push(block.text);
              }
            }
          };

          try {
            const promptBlocks = buildPromptBlocks(targetModule, promptText);
            const result = await entry.connection.prompt({
              sessionId: entry.sessionId,
              prompt: promptBlocks,
            });
            res.writeHead(200);
            const responseText = chunks.join('').trim();
            res.end(JSON.stringify({
              success: true,
              result: responseText || `Agent response (stopReason: ${result.stopReason})`,
            }));
          } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, error: `Prompt failed: ${(err as Error).message}` }));
          } finally {
            entry.launched.onSessionUpdate = prevHandler;
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
    });

    server.on('error', (err) => {
      defaultLogger.error(`MCP backend failed to start: ${err.message}`);
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        mcpBackendPort = addr.port;
        defaultLogger.info(`MCP backend listening on http://127.0.0.1:${mcpBackendPort}`);
        resolve(mcpBackendPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    mcpBackendServer = server;
  });
}

function writeMcpGraphFile(graph: ModuleGraphType): string {
  // Serialize graph to JSON (Map needs conversion to object)
  const nodesObj: Record<string, ModuleGraphNode> = {};
  for (const [name, node] of graph.nodes) {
    nodesObj[name] = node;
  }
  const data = JSON.stringify({ root: graph.root, nodes: nodesObj });
  const filePath = path.join(os.tmpdir(), `module-agent-graph-${Date.now()}.json`);
  fs.writeFileSync(filePath, data, 'utf-8');
  return filePath;
}

function buildMcpServers(): McpServer[] {
  if (!mcpBackendPort) {
    defaultLogger.warn(`MCP: backend port not ready (port=${mcpBackendPort}), skipping mcpServers`);
    return [];
  }
  if (!mcpGraphFile) {
    defaultLogger.warn('MCP: graph file not written, skipping mcpServers');
    return [];
  }

  const serverPath = path.join(app.getAppPath(), 'dist', 'mcp-server.cjs');
  const backendUrl = `http://127.0.0.1:${mcpBackendPort}`;

  if (!fs.existsSync(serverPath)) {
    defaultLogger.warn(`MCP server bundle not found: ${serverPath}. Run: npm run build:mcp-server`);
    return [];
  }

  const servers: McpServer[] = [{
    name: 'module-agent',
    command: 'node',
    args: [serverPath, '--graph-file', mcpGraphFile, '--backend-url', backendUrl],
    env: [],
  }];

  defaultLogger.info(`MCP servers for agent (${servers.length}):`);
  for (const s of servers) {
    if ('command' in s) {
      defaultLogger.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
    } else if ('url' in s) {
      defaultLogger.info(`  http: ${(s as { url: string }).url}`);
    }
    defaultLogger.info(`  Tools: module_list, module_call, module_query, file_access`);
  }

  return servers;
}

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
      loadSystemPrompts();

      // Start MCP backend and write graph for cross-module communication
      try {
        mcpGraphFile = writeMcpGraphFile(graph);
        await startMcpBackend();
        defaultLogger.info(`MCP setup complete: graph=${mcpGraphFile} port=${mcpBackendPort}`);
      } catch (err) {
        defaultLogger.warn(`MCP backend setup failed: ${(err as Error).message}`);
      }

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
  ipcMain.handle('agent:start', async (_event, moduleName: string, cmd: string, args: string[], cwd: string) => {
    if (agents.has(moduleName)) {
      const a = agents.get(moduleName)!;
      return { sessionId: a.sessionId };
    }

    try {
      defaultLogger.info(`agent:start [${moduleName}] cmd=${cmd} args=[${args.join(',')}] cwd=${cwd}`);
      const launched = await launcher.launch({ command: cmd, args }, moduleName, cwd, defaultLogger);

      // Forward session/update stream to renderer
      launched.onSessionUpdate = (name, sessionId, notification) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('agent:stream', {
            moduleName: name, sessionId,
            update: notification.update.sessionUpdate,
            data: notification.update,
          });
        }
      };

      const mcpServers = buildMcpServers();
      defaultLogger.info(`agent:start [${moduleName}] passing ${mcpServers.length} MCP server(s) to newSession`);

      const result = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
      const sessionId = result.sessionId;
      sessionPrompted.delete(moduleName);

      const entry: AgentEntry = {
        connection: launched.connection,
        process: launched.process,
        sessionId,
        config: { command: cmd, args },
        launched,
      };
      agents.set(moduleName, entry);

      return { sessionId };
    } catch (err) {
      defaultLogger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:send', async (_event, moduleName: string, text: string) => {
    let entry = agents.get(moduleName);
    if (!entry) return { error: 'agent not started' };

    // Dedup: ignore identical messages within 3 seconds
    const now = Date.now();
    const last = lastSent.get(moduleName);
    if (last && last.text === text && now - last.time < 3000) {
      defaultLogger.info(`agent:send dedup [${moduleName}] ignored duplicate`);
      return { error: 'duplicate message ignored' };
    }
    lastSent.set(moduleName, { text, time: now });

    try {
      const promptBlocks = buildPromptBlocks(moduleName, text);
      defaultLogger.session(entry.sessionId, 'prompt', `len=${text.length} blocks=${promptBlocks.length}`);
      const result = await entry.connection.prompt({
        sessionId: entry.sessionId,
        prompt: promptBlocks,
      });
      return { stopReason: result.stopReason };
    } catch (err) {
      defaultLogger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
      agents.delete(moduleName);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('agent:cancel', async (_event, moduleName: string) => {
    const entry = agents.get(moduleName);
    if (entry) {
      try { await entry.connection.cancel({ sessionId: entry.sessionId }); } catch {}
      defaultLogger.info(`agent:cancel [${moduleName}]`);
    }
    return {};
  });

  ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
    const entry = agents.get(moduleName);
    if (entry) {
      try { entry.process.kill(); } catch {}
      agents.delete(moduleName);
      sessionPrompted.delete(moduleName);
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
  for (const [, entry] of agents) { try { entry.process.kill(); } catch {} }
  try { mcpBackendServer?.close(); } catch {}
  if (mcpGraphFile) { try { fs.unlinkSync(mcpGraphFile); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});
