#!/usr/bin/env node
/**
 * ModuleAgent Sidecar Server
 *
 * HTTP + SSE server that replaces Electron IPC handlers.
 * Started by Tauri as a sidecar process. Listens on a random port
 * and writes "READY:<port>" to stdout for Tauri to detect.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';
// fileURLToPath imported inline only for ESM fallback

// ── Resolve base paths ──
// In CJS bundle, __dirname is available natively
// When bundled with esbuild, __dirname is the dist-backend/ directory
const BUNDLE_DIR = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

// ── Import core modules ──
import { ModuleAgentCore } from './core/ModuleAgentCore.js';
import { ConfigLoader } from './config/ConfigLoader.js';
import { DEFAULT_CONFIG, DEFAULT_MODULE_GEN_ROLE, type RoleConfig } from './config/defaults.js';
import { defaultLogger, type Logger } from './core/Logger.js';
import { AgentStateManager } from './agents/AgentStateManager.js';
import { McpBackendServer } from './agents/McpBackend.js';
import { ExperienceSummarizer } from './core/ExperienceSummarizer.js';
import { cleanupRoleWorkspace } from './agents/RoleWorkspace.js';
import { ModuleScanner } from './core/ModuleScanner.js';
import { ModuleGraph } from './core/ModuleGraph.js';
import { ModuleGenerator } from './core/ModuleGenerator.js';
import { writeMcpGraphFile, buildMcpServers } from './agents/McpServerBuilder.js';
import { loadSystemPrompts, buildPromptBlocks } from './agents/PromptBuilder.js';
import { AgentLauncher, type AgentConfig } from './agents/AgentLauncher.js';
import { workspacePathForModule, getSubModuleDirs, prepareModuleWorkspace } from './agents/WorkspaceIsolator.js';
import { getPromptConfigDir, ensureConfigFiles, getUserConfigRoot, configExplorer } from './core/ConfigPaths.js';
import type { ModuleGraphNode } from './types/module.js';
import type { ChatMsg, TreeNode } from './types/preload.js';
import type { CoreCallbacks } from './core/CoreTypes.js';
import type { SessionNotification } from '@agentclientprotocol/sdk';

// ── State ──
let core: ModuleAgentCore;
let stateManager: AgentStateManager | null = null;
let mcpBackend: McpBackendServer | null = null;
let summarizer: ExperienceSummarizer;
let summarizationEnabled = true;
let logger: Logger = defaultLogger;
let configDir: string;
let prompts = { mainPrompt: '', subPrompt: '', rolePrompt: '' };
let projectRoot = '';

const agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
const sendLock = new Map<string, Promise<void>>();
const roleSendLock = new Map<string, Promise<void>>();

// SSE clients
const sseClients = new Set<http.ServerResponse>();

// ── Helpers ──
function getBasePath(): string {
  // BUNDLE_DIR is dist-backend/, the project root is one level up
  return path.resolve(BUNDLE_DIR, '..');
}

function sendSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ── Router ──
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const segments = url.pathname.replace(/^\/+/, '').split('/');

  try {
    // ── SSE stream ──
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('event: connected\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ── Parse JSON body for POST/PUT ──
    let body: Record<string, unknown> = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readBody(req);
    }

    // ── Route matching ──
    // /api/project/scan
    if (match(segments, ['api', 'project', 'scan']) && req.method === 'POST') {
      json(res, await handleProjectScan(body.projectRoot as string));
      return;
    }
    // /api/project/tree
    if (match(segments, ['api', 'project', 'tree']) && req.method === 'GET') {
      json(res, handleGetTree());
      return;
    }
    // /api/project/generate
    if (match(segments, ['api', 'project', 'generate']) && req.method === 'POST') {
      json(res, await handleGenerateModules(body.projectRoot as string));
      return;
    }

    // /api/agent/start
    if (match(segments, ['api', 'agent', 'start']) && req.method === 'POST') {
      json(res, await handleAgentStart(body.moduleName as string));
      return;
    }
    // /api/agent/send
    if (match(segments, ['api', 'agent', 'send']) && req.method === 'POST') {
      json(res, await handleAgentSend(body.moduleName as string, body.text as string));
      return;
    }
    // /api/agent/cancel
    if (match(segments, ['api', 'agent', 'cancel']) && req.method === 'POST') {
      json(res, await handleAgentCancel(body.moduleName as string));
      return;
    }
    // /api/agent/stop
    if (match(segments, ['api', 'agent', 'stop']) && req.method === 'POST') {
      json(res, await handleAgentStop(body.moduleName as string));
      return;
    }
    // /api/agent/running
    if (match(segments, ['api', 'agent', 'running']) && req.method === 'GET') {
      json(res, handleGetRunningAgents());
      return;
    }

    // /api/config/get
    if (match(segments, ['api', 'config', 'get']) && req.method === 'GET') {
      json(res, await handleConfigGet(url.searchParams.get('projectRoot') || ''));
      return;
    }
    // /api/config/save
    if (match(segments, ['api', 'config', 'save']) && req.method === 'POST') {
      json(res, await handleConfigSave(body));
      return;
    }

    // /api/context/:name
    if (segments[0] === 'api' && segments[1] === 'context') {
      const moduleName = segments[2] || '';
      if (req.method === 'GET' && moduleName) {
        json(res, await handleContextGet(moduleName));
        return;
      }
      if (req.method === 'DELETE' && moduleName) {
        json(res, await handleContextClear(moduleName));
        return;
      }
      if (req.method === 'DELETE' && !moduleName) {
        json(res, await handleContextClearAll());
        return;
      }
    }

    // /api/roles
    if (segments[0] === 'api' && segments[1] === 'roles') {
      if (req.method === 'GET' && !segments[2]) {
        json(res, await handleRoleList());
        return;
      }
      if (req.method === 'POST' && !segments[2]) {
        json(res, await handleRoleSave(body as unknown as RoleConfig));
        return;
      }
      const roleName = segments[2] || '';
      const subAction = segments[3] || '';
      if (req.method === 'DELETE' && !subAction) {
        json(res, await handleRoleDelete(roleName));
        return;
      }
      if (subAction === 'start' && req.method === 'POST') {
        json(res, await handleRoleStart(roleName));
        return;
      }
      if (subAction === 'send' && req.method === 'POST') {
        json(res, await handleRoleSend(roleName, body.text as string));
        return;
      }
      if (subAction === 'cancel' && req.method === 'POST') {
        json(res, await handleRoleCancel(roleName));
        return;
      }
      if (subAction === 'stop' && req.method === 'POST') {
        json(res, await handleRoleStop(roleName));
        return;
      }
      if (subAction === 'context' && req.method === 'GET') {
        json(res, await handleRoleContextGet(roleName));
        return;
      }
      if (subAction === 'context' && req.method === 'DELETE') {
        json(res, await handleRoleContextClear(roleName));
        return;
      }
    }

    // /api/knowledge
    if (segments[0] === 'api' && segments[1] === 'knowledge') {
      const filename = segments[2] || '';
      if (req.method === 'GET' && !filename) {
        json(res, await handleKnowledgeList());
        return;
      }
      if (req.method === 'GET' && filename) {
        json(res, await handleKnowledgeRead(filename));
        return;
      }
      if (req.method === 'POST' && body.create) {
        json(res, await handleKnowledgeCreate(body.name as string));
        return;
      }
      if (req.method === 'POST') {
        json(res, await handleKnowledgeSave(body as any));
        return;
      }
      if (req.method === 'DELETE' && filename) {
        json(res, await handleKnowledgeDelete(filename));
        return;
      }
    }

    // /api/workflows
    if (segments[0] === 'api' && segments[1] === 'workflows') {
      if (req.method === 'GET' && !segments[2]) {
        json(res, await handleWorkflowList());
        return;
      }
      const wfName = segments[2] || '';
      const wfAction = segments[3] || '';
      if (req.method === 'GET' && wfName && !wfAction) {
        json(res, await handleWorkflowLoad(wfName));
        return;
      }
      if (req.method === 'POST' && !wfName) {
        json(res, await handleWorkflowCreate(body.name as string));
        return;
      }
      if (req.method === 'DELETE' && wfName) {
        json(res, await handleWorkflowDelete(wfName));
        return;
      }
      if (wfAction === 'steps' && req.method === 'POST' && !segments[4]) {
        json(res, await handleWorkflowStepSave(wfName, body.stepName as string, body.content as string));
        return;
      }
      if (wfAction === 'steps' && req.method === 'DELETE') {
        json(res, await handleWorkflowStepDelete(wfName, segments[4] || ''));
        return;
      }
      if (wfAction === 'steps' && segments[4] === 'add' && req.method === 'POST') {
        json(res, await handleWorkflowStepAdd(wfName));
        return;
      }
      if (wfAction === 'execute' && req.method === 'POST') {
        json(res, await handleWorkflowExecute(wfName, body.userInput as string | undefined));
        return;
      }
      if (wfAction === 'cancel' && req.method === 'POST') {
        json(res, await handleWorkflowCancel(wfName));
        return;
      }
      if (wfAction === 'status' && req.method === 'GET') {
        json(res, await handleWorkflowStatus(wfName));
        return;
      }
    }

    // /api/migrate/check
    if (match(segments, ['api', 'migrate', 'check']) && req.method === 'POST') {
      json(res, { needed: [] as string[], streamNeeded: false });
      return;
    }
    // /api/migrate/data
    if (match(segments, ['api', 'migrate', 'data']) && req.method === 'POST') {
      json(res, {});
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${req.method} ${url.pathname}` }));
  } catch (err) {
    logger.error(`[api] Error handling ${req.method} ${url.pathname}: ${(err as Error).message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

// ── Route helpers ──
function match(segs: string[], pattern: string[]): boolean {
  if (segs.length !== pattern.length) return false;
  return segs.every((s, i) => s === pattern[i]);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Handler implementations ──

async function handleProjectScan(projectRootPath: string) {
  try {
    const workspaceConfig = await ConfigLoader.loadOrCreate(projectRootPath);
    if (!workspaceConfig.roles) workspaceConfig.roles = [];
    const hasDefaultRole = workspaceConfig.roles.some((r: RoleConfig) => r.name === DEFAULT_MODULE_GEN_ROLE.name);
    if (!hasDefaultRole) {
      workspaceConfig.roles.push({ ...DEFAULT_MODULE_GEN_ROLE });
      const configPath = path.join(projectRootPath, '.module-agent.json');
      await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
    }

    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    summarizationEnabled = config.summarization?.enabled ?? true;
    const workspaceRoot = path.join(projectRootPath, '.module-agent', 'workspace');

    prompts = { ...loadSystemPrompts(configDir), rolePrompt: '' };
    try {
      const rpPath = path.join(configDir, 'knowledge', 'roleagentprompt.md');
      prompts.rolePrompt = fs.readFileSync(rpPath, 'utf-8');
    } catch { /* optional */ }

    const result = await core.init(projectRootPath);
    core.initRoles(config.projectPath, workspaceRoot);
    core.initWorkflows(config.projectPath, workspaceRoot);

    stateManager = new AgentStateManager(path.join(projectRootPath, '.module-agent', 'context'));

    const moduleScanPath = path.join(projectRootPath, '.module-agent', 'module');
    fs.mkdirSync(moduleScanPath, { recursive: true });
    const descriptors = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });
    const graph = new ModuleGraph().build(descriptors, projectRootPath);

    core.modules.mcpBackendPort = 0;
    core.modules.mcpGraphFile = writeMcpGraphFile(graph, os.tmpdir());

    mcpBackend = new McpBackendServer({
      getAgentEntry(name) {
        const e = core.modules.getAgent(name);
        return e ? { launched: e.launched, sessionId: e.sessionId } : undefined;
      },
      startAgent(name) {
        return core.modules.startAgent(name).then(() => true).catch((err: Error) => {
          logger.error(`MCP: failed to auto-start ${name}: ${err.message}`);
          return false;
        });
      },
      buildPromptBlocks(name, text) {
        return buildPromptBlocks({ moduleName: name, userText: text, graph: graph!, prompts, sessionPrompted: new Set() });
      },
      sendCrossContext(source, target, direction, phase, content) {
        if (direction === 'received' && phase === 'request') {
          stateManager?.startStream(source);
        } else if (direction === 'sent' && phase === 'response') {
          const acc = stateManager?.finishStream(source);
          if (acc) {
            const timeStr = new Date().toLocaleTimeString();
            const agentMsg: ChatMsg = {
              id: 'x' + Date.now().toString(36),
              role: 'agent', content: acc.reply || '', thinking: acc.thinking || '',
              tools: '', timeline: acc.timeline || [], time: timeStr, status: 'completed',
              moduleName: source, agentCmd: '',
            };
            stateManager?.loadContext(source).then(existing => {
              existing.push(agentMsg);
              stateManager?.saveContext(source, existing);
            }).catch(() => {});
          }
        }
        // Enhance timeline
        const st = stateManager?.getStreamState(source);
        if (st && st.timeline) {
          for (let i = st.timeline.length - 1; i >= 0; i--) {
            const ev = st.timeline[i]!;
            if (ev.type === 'tool_call' && (ev.content.includes('module_call') || ev.content.includes('module_query'))) {
              if (!ev.crossModule) {
                ev.crossDirection = direction; ev.crossModule = target;
                ev.crossPhase = phase; ev.detail = content;
              } else {
                ev.crossPhase = phase;
                if (ev.detail) ev.detail = ev.detail + '\n\n---\n\n' + content;
              }
              break;
            }
          }
        }
        sendSSE('cross-context', { moduleName: source, crossModule: target, direction, phase, content, time: new Date().toLocaleTimeString() });
      },
      setAgentStatus(name, status) {
        agentStatus.set(name, status);
        sendSSE('agent-status', { name, status });
      },
      onLog(level, message) {
        if (level === 'error') logger.error(message);
        else if (level === 'warn') logger.warn(message);
        else logger.info(message);
      },
    });

    const port = await mcpBackend.start();
    core.modules.mcpBackendPort = port;
    projectRoot = projectRootPath;

    logger.info(`MCP setup complete: port=${port}`);

    const nodes: Record<string, ModuleGraphNode> = {};
    for (const [name, node] of graph.nodes) {
      nodes[name] = { ...node, workspacePath: workspaceRoot };
    }
    return { root: graph.root, nodes, moduleCount: descriptors.length };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function handleGetTree() {
  const graph = core.getGraph();
  if (!graph) return null;

  const projRoot = core.getProjectRoot();
  const config = core.modules.getConfig();
  const workspaceRoot = path.join(projRoot, '.module-agent', 'workspace');

  function buildTree(node: ModuleGraphNode): TreeNode {
    let cwd: string;
    if (config?.projectPath) {
      if (node.relativePath === '.') {
        cwd = path.join(projRoot, '.module-agent', 'module');
      } else {
        cwd = workspacePathForModule(node, workspaceRoot, projRoot);
      }
    } else {
      cwd = node.absolutePath || projRoot;
    }
    return {
      name: node.name,
      path: node.relativePath,
      description: node.definition.frontmatter.description,
      children: node.children.map(c => graph!.nodes.get(c)).filter(Boolean).map(c => buildTree(c!)),
      cwd,
    };
  }
  const rootNode = graph.nodes.get(graph.root);
  return rootNode ? buildTree(rootNode) : null;
}

async function handleGenerateModules(projRoot: string) {
  // Simplified — delegates to role-based generation in practice
  try {
    const workspaceConfig = await ConfigLoader.loadOrCreate(projRoot);
    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    const moduleScanPath = path.join(projRoot, '.module-agent', 'module');
    fs.ensureDirSync(moduleScanPath);
    const rootModulePath = path.join(moduleScanPath, 'module.md');
    if (!(await fs.pathExists(rootModulePath))) {
      const rootModuleName = path.basename(projRoot);
      await fs.writeFile(rootModulePath,
        `---\nname: ${rootModuleName}\ndescription: ${rootModuleName} project root module\n---\n\n# ${rootModuleName}\n\n## Module Description\n\nTo be filled\n`,
        'utf-8');
    }
    const descriptors = await ModuleScanner.scan({ projectRoot: moduleScanPath, extraExclude: config.exclude });
    return { success: true, count: new Set(descriptors.map(d => d.moduleMdPath)).size };
  } catch (err) {
    return { success: false, count: 0, error: (err as Error).message };
  }
}

async function handleAgentStart(moduleName: string) {
  if (!core.isInitialized()) return { error: 'no module graph loaded' };
  const existing = core.modules.getAgent(moduleName);
  if (existing) return { sessionId: existing.sessionId };
  try {
    const entry = await core.modules.startAgent(moduleName);
    return { sessionId: entry.sessionId };
  } catch (err) {
    logger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
    agentStatus.set(moduleName, 'error');
    sendSSE('agent-status', { name: moduleName, status: 'error' });
    return { error: (err as Error).message };
  }
}

async function handleAgentSend(moduleName: string, text: string) {
  if (!core.isInitialized()) return { error: 'no module graph loaded' };
  const prevLock = sendLock.get(moduleName);
  if (prevLock) { try { await prevLock; } catch { /* continue */ } }
  let resolveLock: () => void = () => {};
  const lockPromise = new Promise<void>(r => { resolveLock = r; });
  sendLock.set(moduleName, lockPromise);

  try {
    let entry = core.modules.getAgent(moduleName);
    if (!entry) {
      entry = await core.modules.startAgent(moduleName);
    }
    agentStatus.set(moduleName, 'streaming');
    sendSSE('agent-status', { name: moduleName, status: 'streaming' });

    const promptBlocks = buildPromptBlocks({
      moduleName, userText: text, graph: core.getGraph()!, prompts, sessionPrompted: new Set(),
    });

    stateManager?.startStream(moduleName);

    const result = await entry.launched.connection.prompt({
      sessionId: entry.sessionId, prompt: promptBlocks,
    });

    const acc = stateManager?.finishStream(moduleName);
    const timeStr = new Date().toLocaleTimeString();
    const userMsg: ChatMsg = {
      id: 'm' + Date.now().toString(36), role: 'user', content: text, thinking: '',
      tools: '', time: timeStr, status: 'sent', moduleName, agentCmd: '',
    };
    const agentMsg: ChatMsg = {
      id: 'm' + (Date.now() + 1).toString(36), role: 'agent',
      content: acc?.reply || '', thinking: acc?.thinking || '',
      tools: acc?.tools || '', timeline: acc?.timeline || [],
      time: timeStr, status: 'completed', moduleName, agentCmd: '',
    };
    const existingMsgs = await stateManager?.loadContext(moduleName) ?? [];
    existingMsgs.push(userMsg, agentMsg);
    await stateManager?.saveContext(moduleName, existingMsgs);

    if (projectRoot && summarizationEnabled) {
      summarizer.summarize({
        moduleName, chatMsgs: existingMsgs, projectRoot, configDir,
        agentConfig: { command: entry.config.command, args: entry.config.args },
      }).catch(err => logger.warn(`Summarizer error [${moduleName}]: ${(err as Error).message}`));
    }

    agentStatus.set(moduleName, 'idle');
    sendSSE('agent-status', { name: moduleName, status: 'idle' });

    return {
      result: {
        reply: acc?.reply || '', thinking: acc?.thinking || '',
        tools: acc?.tools || '', timeline: acc?.timeline || [],
        stopReason: result.stopReason,
      },
    };
  } catch (err) {
    logger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
    stateManager?.stopStream(moduleName);
    agentStatus.set(moduleName, 'error');
    sendSSE('agent-status', { name: moduleName, status: 'error' });
    return { error: (err as Error).message };
  } finally {
    resolveLock();
    sendLock.delete(moduleName);
  }
}

async function handleAgentCancel(moduleName: string) {
  const entry = core.modules.getAgent(moduleName);
  if (entry) {
    try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* ignore */ }
    agentStatus.set(moduleName, 'idle');
    sendSSE('agent-status', { name: moduleName, status: 'idle' });
  }
  const acc = stateManager?.cancelStream(moduleName);
  return { accumulated: acc };
}

async function handleAgentStop(moduleName: string) {
  const entry = core.modules.getAgent(moduleName);
  if (entry) {
    try { entry.launched.process.kill(); } catch { /* ignore */ }
    (core.modules as any).agents?.delete?.(moduleName);
    agentStatus.delete(moduleName);
    sendSSE('agent-status', { name: moduleName, status: 'stopped' });
  }
  stateManager?.stopStream(moduleName);
  return {};
}

function handleGetRunningAgents() {
  return core.modules.listAgents().map(name => ({
    name, status: agentStatus.get(name) || 'idle',
  }));
}

// ── Config ──
async function handleConfigGet(projRoot: string) {
  try {
    const workspaceConfig = await ConfigLoader.load(projRoot);
    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    return { command: config.agents.default.command, args: config.agents.default.args || [],
      projectPath: config.projectPath, summarizationEnabled: config.summarization?.enabled ?? true };
  } catch {
    return { command: DEFAULT_CONFIG.agents.default.command, args: DEFAULT_CONFIG.agents.default.args || [],
      projectPath: DEFAULT_CONFIG.projectPath, summarizationEnabled: true };
  }
}

async function handleConfigSave(body: Record<string, unknown>) {
  const projRoot = body.projectRoot as string;
  const configPath = path.join(projRoot, '.module-agent.json');
  let workspaceConfig;
  try { workspaceConfig = await ConfigLoader.load(projRoot); }
  catch { workspaceConfig = { configs: [{ name: 'default', ...DEFAULT_CONFIG }], defaultConfig: 'default' }; }
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  if (body.command) config.agents.default.command = body.command as string;
  if (body.args) config.agents.default.args = body.args as string[];
  if (body.projectPath !== undefined) config.projectPath = body.projectPath as string;
  if (body.summarizationEnabled !== undefined) {
    config.summarization = { enabled: body.summarizationEnabled as boolean };
    summarizationEnabled = body.summarizationEnabled as boolean;
  }
  await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
  return { success: true };
}

// ── Context ──
async function handleContextGet(moduleName: string) { return stateManager?.loadContext(moduleName) ?? []; }
async function handleContextClear(moduleName: string) { await stateManager?.clearContext(moduleName); return {}; }
async function handleContextClearAll() { await stateManager?.clearAllContexts(); return {}; }

// ── Roles ──
async function handleRoleList() {
  try {
    const workspaceConfig = await ConfigLoader.load(core.getProjectRoot() || process.cwd());
    return workspaceConfig.roles || [];
  } catch { return []; }
}

async function handleRoleSave(role: RoleConfig) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  const configPath = path.join(projRoot, '.module-agent.json');
  let workspaceConfig = await ConfigLoader.load(projRoot);
  if (!workspaceConfig.roles) workspaceConfig.roles = [];
  const idx = workspaceConfig.roles.findIndex((r: RoleConfig) => r.name === role.name);
  if (idx >= 0) workspaceConfig.roles[idx] = role;
  else workspaceConfig.roles.push(role);
  await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
  configExplorer.clearCaches();
  return { success: true };
}

async function handleRoleDelete(name: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  const configPath = path.join(projRoot, '.module-agent.json');
  let workspaceConfig = await ConfigLoader.load(projRoot);
  if (workspaceConfig.roles) workspaceConfig.roles = workspaceConfig.roles.filter((r: RoleConfig) => r.name !== name);
  await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
  configExplorer.clearCaches();
  const workspaceRoot = path.join(projRoot, '.module-agent', 'workspace');
  await cleanupRoleWorkspace(name, workspaceRoot);
  await core.roles?.stopRole(name);
  return { success: true };
}

async function handleRoleStart(roleName: string) {
  if (!core.roles) return { error: 'no role agent manager' };
  const existing = core.roles.getAgent(roleName);
  if (existing) return { sessionId: existing.sessionId };
  try {
    const workspaceConfig = await ConfigLoader.load(core.getProjectRoot());
    const role = workspaceConfig.roles?.find((r: RoleConfig) => r.name === roleName);
    if (!role) return { error: `role not found: ${roleName}` };
    const entry = await core.roles.startRole(role);
    return { sessionId: entry.sessionId };
  } catch (err) { return { error: (err as Error).message }; }
}

async function handleRoleSend(roleName: string, text: string) {
  if (!core.roles) return { error: 'no role agent manager' };
  const prevLock = roleSendLock.get(roleName);
  if (prevLock) { try { await prevLock; } catch { /* continue */ } }
  let resolveLock: () => void = () => {};
  const lockPromise = new Promise<void>(r => { resolveLock = r; });
  roleSendLock.set(roleName, lockPromise);

  try {
    let entry = core.roles.getAgent(roleName);
    if (!entry) {
      const workspaceConfig = await ConfigLoader.load(core.getProjectRoot());
      const role = workspaceConfig.roles?.find((r: RoleConfig) => r.name === roleName);
      if (!role) return { error: `role not found: ${roleName}` };
      entry = await core.roles.startRole(role);
    }

    const ctxKey = `workrole:${roleName}`;
    agentStatus.set(roleName, 'streaming');
    sendSSE('role-status', { name: roleName, status: 'streaming' });

    stateManager?.startStream(ctxKey);

    const blocks = buildRolePromptBlocks(roleName, text);
    const result = await entry.launched.connection.prompt({ sessionId: entry.sessionId, prompt: blocks });

    const acc = stateManager?.finishStream(ctxKey);
    const timeStr = new Date().toLocaleTimeString();
    const userMsg: ChatMsg = {
      id: 'r' + Date.now().toString(36), role: 'user', content: text, thinking: '',
      tools: '', time: timeStr, status: 'sent', moduleName: ctxKey, agentCmd: '',
    };
    const agentMsg: ChatMsg = {
      id: 'r' + (Date.now() + 1).toString(36), role: 'agent',
      content: acc?.reply || '', thinking: acc?.thinking || '',
      tools: acc?.tools || '', timeline: acc?.timeline || [],
      time: timeStr, status: 'completed', moduleName: ctxKey, agentCmd: '',
    };
    const existingMsgs = await stateManager?.loadContext(ctxKey) ?? [];
    existingMsgs.push(userMsg, agentMsg);
    await stateManager?.saveContext(ctxKey, existingMsgs);

    agentStatus.set(roleName, 'idle');
    sendSSE('role-status', { name: roleName, status: 'idle' });

    return {
      result: {
        reply: acc?.reply || '', thinking: acc?.thinking || '',
        tools: acc?.tools || '', stopReason: result.stopReason,
      },
    };
  } catch (err) {
    logger.error(`role:send failed [${roleName}]: ${(err as Error).message}`);
    stateManager?.stopStream(`workrole:${roleName}`);
    agentStatus.set(roleName, 'error');
    sendSSE('role-status', { name: roleName, status: 'error' });
    return { error: (err as Error).message };
  } finally {
    resolveLock();
    roleSendLock.delete(roleName);
  }
}

async function handleRoleCancel(roleName: string) {
  if (core.roles) {
    try { await core.roles.cancel(roleName); } catch { /* ignore */ }
    agentStatus.set(roleName, 'idle');
    sendSSE('role-status', { name: roleName, status: 'idle' });
  }
  const acc = stateManager?.cancelStream(`workrole:${roleName}`);
  return { accumulated: acc };
}

async function handleRoleStop(roleName: string) {
  if (core.roles) {
    try { await core.roles.stopRole(roleName); } catch { /* ignore */ }
    agentStatus.delete(roleName);
    sendSSE('role-status', { name: roleName, status: 'stopped' });
  }
  return {};
}

async function handleRoleContextGet(roleName: string) {
  return stateManager?.loadContext(`workrole:${roleName}`) ?? [];
}

async function handleRoleContextClear(roleName: string) {
  await stateManager?.clearContext(`workrole:${roleName}`);
  return {};
}

// ── Knowledge ──
async function handleKnowledgeList() {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return [];
  const knowledgeDir = path.join(projRoot, '.module-agent', 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return [];
  const files = await fs.promises.readdir(knowledgeDir);
  return files.filter(f => f.endsWith('.md')).map(f => {
    const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf-8');
    const nameMatch = content.match(/^#\s+(.+)/m);
    return { filename: f, name: nameMatch ? nameMatch[1]!.trim() : f.replace('.md', '') };
  });
}

async function handleKnowledgeRead(filename: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return null;
  const filePath = path.join(projRoot, '.module-agent', 'knowledge', filename);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const nameMatch = content.match(/^#\s+(.+)/m);
  return { filename, name: nameMatch ? nameMatch[1]!.trim() : filename.replace('.md', ''), content };
}

async function handleKnowledgeCreate(name: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { error: 'no project' };
  const knowledgeDir = path.join(projRoot, '.module-agent', 'knowledge');
  fs.ensureDirSync(knowledgeDir);
  const filename = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_') + '.md';
  const filePath = path.join(knowledgeDir, filename);
  if (fs.existsSync(filePath)) return { error: '文件已存在' };
  await fs.promises.writeFile(filePath, `# ${name}\n\n`, 'utf-8');
  return { filename, name, content: `# ${name}\n\n` };
}

async function handleKnowledgeSave(entry: { filename: string; name: string; content: string }) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  const filePath = path.join(projRoot, '.module-agent', 'knowledge', entry.filename);
  await fs.promises.writeFile(filePath, entry.content, 'utf-8');
  return { success: true };
}

async function handleKnowledgeDelete(filename: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot || !filename) return { success: false };
  const filePath = path.join(projRoot, '.module-agent', 'knowledge', filename);
  if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
  return { success: true };
}

// ── Workflows ──
async function handleWorkflowList() {
  if (!core.workflows) return [];
  try {
    const names = core.workflows.listWorkflows();
    return names.map(name => {
      const wf = core.workflows!.loadWorkflow(name);
      return { name, stepCount: wf?.steps.length ?? 0 };
    });
  } catch { return []; }
}

async function handleWorkflowLoad(name: string) {
  if (!core.workflows) return { error: 'workflow subsystem not initialized' };
  try {
    const wf = core.workflows.loadWorkflow(name);
    if (!wf) return { error: `workflow not found: ${name}` };
    return wf;
  } catch (err) { return { error: (err as Error).message }; }
}

async function handleWorkflowCreate(name: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false, error: 'no project root' };
  try {
    const wfDir = path.join(projRoot, '.module-agent', 'workflow', name);
    const stepDir = path.join(wfDir, 'step1');
    await fs.ensureDir(stepDir);
    const stepMd = ['---', 'name: ' + name, '---', '', '# ' + name, '', '请描述第一步要完成的工作...'].join('\n');
    await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
    return { success: true };
  } catch (err) { return { success: false, error: (err as Error).message }; }
}

async function handleWorkflowDelete(name: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  try {
    const wfDir = path.join(projRoot, '.module-agent', 'workflow', name);
    if (fs.existsSync(wfDir)) await fs.remove(wfDir);
    const stateFile = path.join(projRoot, '.module-agent', 'workflow', `${name}.state.json`);
    if (fs.existsSync(stateFile)) await fs.promises.unlink(stateFile);
    return { success: true };
  } catch { return { success: false }; }
}

async function handleWorkflowStepSave(wfName: string, stepName: string, content: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  try {
    const filePath = path.join(projRoot, '.module-agent', 'workflow', wfName, stepName, 'STEP.md');
    await fs.ensureDir(path.dirname(filePath));
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) { return { success: false, error: (err as Error).message }; }
}

async function handleWorkflowStepDelete(wfName: string, stepName: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false };
  try {
    const stepDir = path.join(projRoot, '.module-agent', 'workflow', wfName, stepName);
    if (fs.existsSync(stepDir)) await fs.remove(stepDir);
    return { success: true };
  } catch (err) { return { success: false, error: (err as Error).message }; }
}

async function handleWorkflowStepAdd(wfName: string) {
  const projRoot = core.getProjectRoot();
  if (!projRoot) return { success: false, error: 'no project root' };
  try {
    const wfDir = path.join(projRoot, '.module-agent', 'workflow', wfName);
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
    const stepMd = ['---', 'name: ' + nextStep, '---', '', '# ' + nextStep, '', '请描述此步骤要完成的工作...'].join('\n');
    await fs.promises.writeFile(path.join(stepDir, 'STEP.md'), stepMd, 'utf-8');
    return { success: true, stepName: nextStep };
  } catch (err) { return { success: false, error: (err as Error).message }; }
}

async function handleWorkflowExecute(name: string, userInput?: string) {
  if (!core.workflows) return { error: 'workflow subsystem not initialized' };
  try {
    const results = await core.workflows.executeWorkflow(name, userInput);
    return { success: true, results };
  } catch (err) { return { error: (err as Error).message }; }
}

async function handleWorkflowCancel(name: string) {
  if (core.workflows) await core.workflows.cancel(name);
}

async function handleWorkflowStatus(name: string) {
  if (!core.workflows) return null;
  const state = core.workflows.getExecutionState(name);
  if (!state) return null;
  return {
    status: state.status,
    currentStep: state.currentStepIndex,
    totalSteps: state.stepResults.length,
    results: state.stepResults,
  };
}

function buildRolePromptBlocks(roleName: string, userText: string) {
  const blocks: { type: 'text'; text: string }[] = [];
  if (prompts.rolePrompt) {
    blocks.push({ type: 'text', text: prompts.rolePrompt + '\n\n---\n\n' });
  }
  blocks.push({ type: 'text', text: userText });
  return blocks;
}

// ── Initialize & start server ──
async function init() {
  const basePath = getBasePath();
  configDir = getPromptConfigDir(basePath);

  try { ensureConfigFiles(path.join(basePath, 'config')); } catch { /* optional */ }

  logger = defaultLogger;
  // In sidecar mode, log to stderr so Tauri can capture it
  defaultLogger.configure(path.join(os.tmpdir(), 'module-agent-logs'), 3);

  summarizer = new ExperienceSummarizer(logger);

  prompts = { ...loadSystemPrompts(configDir), rolePrompt: '' };
  try {
    const rpPath = path.join(configDir, 'knowledge', 'roleagentprompt.md');
    prompts.rolePrompt = fs.readFileSync(rpPath, 'utf-8');
  } catch { /* optional */ }

  const callbacks: CoreCallbacks = {
    onStreamChunk: () => {},
    onStreamComplete: () => {},
    onStreamError: (moduleName, error) => {
      agentStatus.set(moduleName, 'error');
      sendSSE('agent-status', { name: moduleName, status: 'error' });
      logger.error(`[${moduleName}] stream error: ${error}`);
    },
    onStatusChange: () => {},
    onMessage: () => {},
  };

  core = new ModuleAgentCore({
    callbacks, basePath, configDir, logger,
    onSessionUpdate: (moduleName, _sessionId, notification) => {
      const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
      stateManager?.appendChunk(moduleName, update || '', notification.update as Record<string, unknown>);
      const acc = stateManager?.getStreamState(moduleName);
      sendSSE('agent-stream', {
        moduleName, update, data: notification.update,
        reply: acc?.reply, thinking: acc?.thinking, tools: acc?.tools,
        timeline: acc?.timeline, sections: acc?.sections,
      });
    },
    onRoleSessionUpdate: (roleName, _sessionId, notification) => {
      const ctxKey = `workrole:${roleName}`;
      const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
      stateManager?.appendChunk(ctxKey, update || '', notification.update as Record<string, unknown>);
      const acc = stateManager?.getStreamState(ctxKey);
      sendSSE('role-stream', {
        moduleName: roleName, update, data: notification.update,
        reply: acc?.reply, thinking: acc?.thinking, tools: acc?.tools,
        timeline: acc?.timeline, sections: acc?.sections,
      });
    },
  });

  logger.info('ModuleAgent sidecar initialized');
}

// ── Main ──
const PORT = parseInt(process.env.SIDECAR_PORT || '0', 10) || 0;

const server = http.createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    const actualPort = addr.port;
    // Signal readiness to Tauri
    process.stdout.write(`READY:${actualPort}\n`);
    logger.info(`Sidecar server listening on http://127.0.0.1:${actualPort}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Sidecar shutting down...');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Sidecar interrupted...');
  server.close();
  process.exit(0);
});

// Initialize core
init().catch(err => {
  logger.error(`Sidecar init failed: ${(err as Error).message}`);
  process.exit(1);
});
