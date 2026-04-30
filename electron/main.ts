import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import http from 'node:http';
import os from 'os';
import { context as esbuildContext } from 'esbuild';
import { ModuleScanner } from '../src/core/ModuleScanner.js';
import { ModuleGraph } from '../src/core/ModuleGraph.js';
import { ConfigLoader } from '../src/config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../src/config/defaults.js';
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
let currentWorkspaceRoot = '';
let currentCodeSource: { type: 'git' | 'local'; url?: string; branch?: string; path?: string } | null = null;

interface AgentEntry {
  connection: ClientSideConnection;
  process: ChildProcess;
  sessionId: string;
  config: { command: string; args?: string[] };
  launched: LaunchedAgent;
}
const agents = new Map<string, AgentEntry>();
const agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
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
  const mainPath = path.join(currentProjectRoot, 'config', 'mainagentprompt.md');
  const subPath = path.join(currentProjectRoot, 'config', 'subagentprompt.md');
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

function sendCrossContext(moduleName: string, crossModule: string, direction: 'sent' | 'received', phase: 'request' | 'response', content: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:cross-context', { moduleName, crossModule, direction, phase, content, time: new Date().toLocaleTimeString() });
  }
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
          const requestingModule = msg.requestingModule || '';
          const taskContent = msg.task || msg.query || '';

          // Emit cross-context: request phase
          if (requestingModule && targetModule) {
            sendCrossContext(requestingModule, targetModule, 'sent', 'request', taskContent);
            sendCrossContext(targetModule, requestingModule, 'received', 'request', taskContent);
          }

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
            agentStatus.set(targetModule, 'streaming');
            const promptBlocks = buildPromptBlocks(targetModule, promptText);
            const result = await entry.connection.prompt({
              sessionId: entry.sessionId,
              prompt: promptBlocks,
            });
            agentStatus.set(targetModule, 'idle');
            res.writeHead(200);
            const responseText = chunks.join('').trim();
            res.end(JSON.stringify({
              success: true,
              result: responseText || `Agent response (stopReason: ${result.stopReason})`,
            }));

            // Emit cross-context: response phase
            if (requestingModule && targetModule && responseText) {
              sendCrossContext(targetModule, requestingModule, 'sent', 'response', responseText.slice(0, 200));
              sendCrossContext(requestingModule, targetModule, 'received', 'response', responseText.slice(0, 200));
            }
          } catch (err) {
            agentStatus.set(targetModule, 'error');
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

async function ensureModuleAgentRunning(moduleName: string): Promise<boolean> {
  if (agents.has(moduleName)) return true;

  const node = currentGraph?.nodes.get(moduleName);
  if (!node) {
    defaultLogger.warn(`MCP: cannot start agent for unknown module: ${moduleName}`);
    return false;
  }

  // Resolve agent config — use default from project config
  let cmd = 'opencode';
  let args = ['acp'];
  try {
    const config = await ConfigLoader.load(currentProjectRoot);
    cmd = config.agents.default.command;
    args = config.agents.default.args || [];
  } catch {}

  await prepareModuleWorkspace(node);
  const cwd = workspacePathForModule(node);
  try {
    defaultLogger.info(`MCP: auto-starting agent for module ${moduleName} (cmd=${cmd} cwd=${cwd})`);
    const launched = await launcher.launch({ command: cmd, args }, moduleName, cwd, defaultLogger);

    launched.onSessionUpdate = (name, sessionId, notification) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:stream', {
          moduleName: name, sessionId,
          update: notification.update.sessionUpdate,
          data: notification.update,
        });
      }
    };

    const mcpServers = buildMcpServers(moduleName);
    const result = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
    sessionPrompted.delete(moduleName);

    agents.set(moduleName, {
      connection: launched.connection,
      process: launched.process,
      sessionId: result.sessionId,
      config: { command: cmd, args },
      launched,
    });
    agentStatus.set(moduleName, 'idle');

    defaultLogger.info(`MCP: auto-started agent for ${moduleName} session=${result.sessionId}`);
    return true;
  } catch (err) {
    defaultLogger.error(`MCP: failed to auto-start agent for ${moduleName}: ${(err as Error).message}`);
    return false;
  }
}

function workspacePathForModule(node: ModuleGraphNode): string {
  if (currentWorkspaceRoot) {
    return node.relativePath === '.'
      ? path.join(currentWorkspaceRoot, node.name)
      : path.join(currentWorkspaceRoot, node.relativePath);
  }
  return node.absolutePath || path.join(currentProjectRoot, node.relativePath);
}

function codeSourcePathForModule(node: ModuleGraphNode): string {
  if (!currentCodeSource) return '';

  const resolvePath = (base: string): string => {
    if (node.relativePath === '.') return base;

    // Try direct mapping: <base>/<relativePath>
    const direct = path.join(base, node.relativePath);
    if (fs.existsSync(direct)) return direct;

    // Try with src/ prefix (common for Rust/Java projects)
    const srcPath = path.join(base, 'src', node.relativePath);
    if (fs.existsSync(srcPath)) return srcPath;

    // Fallback: return direct path (caller will verify existence)
    return direct;
  };

  if (currentCodeSource.type === 'local' && currentCodeSource.path) {
    return resolvePath(currentCodeSource.path);
  }

  return '';
}

const gitCacheDir = new Map<string, string>();

async function resolveGitCodeSource(): Promise<string> {
  if (!currentCodeSource || currentCodeSource.type !== 'git' || !currentCodeSource.url) return '';

  const cacheKey = `${currentCodeSource.url}@${currentCodeSource.branch || 'main'}`;
  const cached = gitCacheDir.get(cacheKey);
  if (cached && fs.existsSync(cached)) return cached;

  const repoName = (currentCodeSource.url.split('/').pop() || 'repo').replace(/\.git$/, '');
  const cachePath = path.join(os.tmpdir(), 'module-agent-git', repoName);

  if (fs.existsSync(cachePath)) {
    defaultLogger.info(`Git cache exists, pulling: ${cachePath}`);
    try {
      const git = await import('simple-git');
      await git.simpleGit(cachePath).pull();
    } catch (err) {
      defaultLogger.warn(`Git pull failed, using cached copy: ${(err as Error).message}`);
    }
  } else {
    defaultLogger.info(`Cloning ${currentCodeSource.url} -> ${cachePath}`);
    await fse.ensureDir(path.dirname(cachePath));
    const git = await import('simple-git');
    const branch = currentCodeSource.branch || 'main';
    await git.simpleGit().clone(currentCodeSource.url, cachePath, ['--branch', branch, '--single-branch']);
  }

  gitCacheDir.set(cacheKey, cachePath);
  return cachePath;
}

async function prepareModuleWorkspace(node: ModuleGraphNode): Promise<string> {
  if (!currentWorkspaceRoot) return node.absolutePath;

  const destDir = node.relativePath === '.'
    ? path.join(currentWorkspaceRoot, node.name)
    : path.join(currentWorkspaceRoot, node.relativePath);

  // Resolve source directory — support git clone
  let srcDir = codeSourcePathForModule(node);
  if (!srcDir && currentCodeSource?.type === 'git') {
    const gitRoot = await resolveGitCodeSource();
    if (gitRoot) {
      // Try direct and src/ prefix mappings (same as codeSourcePathForModule)
      const direct = path.join(gitRoot, node.relativePath);
      const srcPath = path.join(gitRoot, 'src', node.relativePath);
      if (node.relativePath === '.') {
        srcDir = gitRoot;
      } else if (fs.existsSync(direct)) {
        srcDir = direct;
      } else if (fs.existsSync(srcPath)) {
        srcDir = srcPath;
      } else {
        srcDir = direct; // caller will check existence
      }
    }
  }
  if (!srcDir) {
    defaultLogger.warn(`Module ${node.name}: no code source configured, skipping isolation`);
    return node.absolutePath;
  }

  if (!fs.existsSync(srcDir)) {
    defaultLogger.warn(`Module ${node.name}: source dir not found: ${srcDir}, skipping isolation`);
    // Ensure workspace directory still exists so agent has a valid cwd
    await fse.ensureDir(destDir);
    return destDir;
  }

  if (path.resolve(srcDir) === path.resolve(destDir)) return destDir;

  // Collect submodule relative paths to exclude from root module copy
  const subModulePaths = new Set<string>();
  if (node.relativePath === '.') {
    for (const childName of node.children) {
      const child = currentGraph?.nodes.get(childName);
      if (child?.relativePath) {
        subModulePaths.add(child.relativePath);
      }
    }
  }

  try {
    defaultLogger.info(`Isolating module ${node.name}: ${srcDir} -> ${destDir}`);
    await fse.ensureDir(path.dirname(destDir));
    await fse.copy(srcDir, destDir, {
      overwrite: true,
      errorOnExist: false,
      filter: (src: string) => {
        const basename = path.basename(src);
        if (basename === 'node_modules' || basename === '.git') return false;
        if (subModulePaths.size > 0) {
          const rel = path.relative(srcDir, src);
          if (rel && [...subModulePaths].some(s => rel === s || rel.startsWith(s + path.sep))) return false;
        }
        return true;
      },
    });
    return destDir;
  } catch (err) {
    defaultLogger.error(`Failed to isolate module ${node.name}: ${(err as Error).message}`);
    return node.absolutePath;
  }
}

function buildMcpServers(moduleName: string): McpServer[] {
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

  const args = [serverPath, '--graph-file', mcpGraphFile, '--backend-url', backendUrl];
  if (moduleName) args.push('--module-name', moduleName);

  const servers: McpServer[] = [{
    name: 'module-agent',
    command: 'node',
    args,
    env: [],
  }];

  defaultLogger.info(`MCP servers for agent (${servers.length}):`);
  for (const s of servers) {
    if ('command' in s) {
      defaultLogger.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
    } else if ('url' in s) {
      defaultLogger.info(`  http: ${(s as { url: string }).url}`);
    }
    defaultLogger.info(`  Tools: module_list, module_call, module_query`);
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
      currentWorkspaceRoot = workspaceRoot;
      currentCodeSource = config.codeSource || null;
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
        children: node.children.map(c => currentGraph!.nodes.get(c)).filter(Boolean).map(c => buildTree(c!)),
      };
    }
    const rootNode = currentGraph.nodes.get(currentGraph.root);
    return rootNode ? buildTree(rootNode) : null;
  });

  // ── Agent IPC ──
  ipcMain.handle('agent:start', async (_event, moduleName: string, _cmd: string, _args: string[], cwd: string) => {
    if (agents.has(moduleName)) {
      const a = agents.get(moduleName)!;
      return { sessionId: a.sessionId };
    }

    try {
      // Resolve agent config — prefer config file, fallback to passed params
      let cmd = _cmd || 'opencode';
      let args = _args?.length ? _args : ['acp'];
      try {
        const projectConfig = await ConfigLoader.load(currentProjectRoot);
        cmd = projectConfig.agents.default.command;
        args = projectConfig.agents.default.args || [];
      } catch {}

      // Compute isolated cwd when workspace is configured
      let agentCwd = cwd;
      const node = currentGraph?.nodes.get(moduleName);
      if (node && currentWorkspaceRoot) {
        await prepareModuleWorkspace(node);
        agentCwd = workspacePathForModule(node);
      }

      defaultLogger.info(`agent:start [${moduleName}] cmd=${cmd} args=[${args.join(',')}] cwd=${agentCwd}`);
      const launched = await launcher.launch({ command: cmd, args }, moduleName, agentCwd, defaultLogger);

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

      const mcpServers = buildMcpServers(moduleName);
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
      agentStatus.set(moduleName, 'idle');

      return { sessionId };
    } catch (err) {
      defaultLogger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      agentStatus.set(moduleName, 'error');
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
      agentStatus.set(moduleName, 'streaming');
      const promptBlocks = buildPromptBlocks(moduleName, text);
      defaultLogger.session(entry.sessionId, 'prompt', `len=${text.length} blocks=${promptBlocks.length}`);
      const result = await entry.connection.prompt({
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
    const entry = agents.get(moduleName);
    if (entry) {
      try { await entry.connection.cancel({ sessionId: entry.sessionId }); } catch {}
      agentStatus.set(moduleName, 'idle');
      defaultLogger.info(`agent:cancel [${moduleName}]`);
    }
    return {};
  });

  ipcMain.handle('agent:stop', async (_event, moduleName: string) => {
    const entry = agents.get(moduleName);
    if (entry) {
      try { entry.process.kill(); } catch {}
      agents.delete(moduleName);
      agentStatus.delete(moduleName);
      sessionPrompted.delete(moduleName);
      defaultLogger.info(`agent:stop [${moduleName}]`);
    }
    return {};
  });

  ipcMain.handle('agent:isRunning', (_event, moduleName: string) => {
    return agents.has(moduleName);
  });

  ipcMain.handle('agent:getRunning', () => {
    return [...agents.keys()].map(name => ({
      name,
      status: agentStatus.get(name) || 'idle',
    }));
  });

  // ── Config IPC ──
  ipcMain.handle('config:save', async (_event, projectRoot: string, updates: { command?: string; args?: string[]; codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string } }) => {
    const configPath = path.join(projectRoot, '.module-agent.json');
    let config: ProjectConfig;
    try {
      config = await ConfigLoader.load(projectRoot);
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
    if (updates.command) config.agents.default.command = updates.command;
    if (updates.args) config.agents.default.args = updates.args;
    if (updates.codeSource) config.codeSource = updates.codeSource;
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    defaultLogger.info(`config:save wrote to ${configPath}`);
    return { success: true };
  });

  ipcMain.handle('config:get', async (_event, projectRoot: string) => {
    try {
      const config = await ConfigLoader.load(projectRoot);
      return { command: config.agents.default.command, args: config.agents.default.args || [], codeSource: config.codeSource };
    } catch {
      return { command: DEFAULT_CONFIG.agents.default.command, args: DEFAULT_CONFIG.agents.default.args || [], codeSource: DEFAULT_CONFIG.codeSource };
    }
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
