import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { AgentManager, type AgentEntry } from '../../agents/AgentManager.js';
import { AgentRouter } from '../../agents/AgentRouter.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { defaultLogger } from '../../core/Logger.js';
import { buildMcpServers, writeMcpGraphFile } from '../../agents/McpServerBuilder.js';
import { getSubModuleDirs, workspacePathForModule } from '../../agents/WorkspaceIsolator.js';
import type { ModuleDescriptor, ModuleGraph as ModuleGraphType } from '../../types/module.js';
import type { ConfigEntry } from '../../config/defaults.js';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { StreamHandler } from './StreamHandler.js';
import type { ChatMessage, AgentStatus } from '../types.js';

function findRepoRoot(): string {
  let dir = __dirname || path.resolve(process.argv[1] || process.cwd(), '..');
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export class AgentService {
  private projectRoot = '';
  private config: ConfigEntry | null = null;
  private graph: ModuleGraphType | null = null;
  private agentManager: AgentManager | null = null;
  private agentRouter: AgentRouter | null = null;
  private currentAgent = 'main';
  private entries: Map<string, AgentEntry> = new Map();
  private status: AgentStatus = 'idle';
  private streamHandler: StreamHandler | null = null;

  private onMessage: (msg: ChatMessage) => void;
  private onStatusChange: (status: AgentStatus) => void;

  onSessionUpdate: ((moduleName: string, sessionId: string, notification: SessionNotification) => void) | null = null;

  constructor(
    onMessage: (msg: ChatMessage) => void,
    onStatusChange: (status: AgentStatus) => void,
  ) {
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
  }

  async init(projectRoot: string): Promise<void> {
    this.projectRoot = projectRoot;
    this.setStatus('loading');

    const workspaceConfig = await ConfigLoader.load(projectRoot);
    this.config = ConfigLoader.getDefaultConfig(workspaceConfig);

    const descriptors: ModuleDescriptor[] = [];

    const projectDesc = await ModuleScanner.scan({
      projectRoot,
      extraExclude: this.config.exclude,
    });
    descriptors.push(...projectDesc);

    const moduleScanPath = path.join(this.config.projectPath, '.module-agent', 'module');

    if (moduleScanPath !== path.resolve(projectRoot)) {
      defaultLogger.info(`ModuleScanner: scanning modulesPath ${moduleScanPath}`);
      try {
        fs.ensureDirSync(moduleScanPath);
        const codeDesc = await ModuleScanner.scan({
          projectRoot: moduleScanPath,
          extraExclude: this.config.exclude,
        });
        const seen = new Set(projectDesc.map((d) => d.moduleMdPath));
        for (const d of codeDesc) {
          if (!seen.has(d.moduleMdPath)) {
            descriptors.push(d);
          }
        }
        defaultLogger.info(`ModuleScanner: found ${codeDesc.length} modules in modulesPath`);
      } catch (err) {
        defaultLogger.warn(`ModuleScanner: failed to scan modulesPath ${moduleScanPath} | ${(err as Error).message}`);
      }
    } else {
      defaultLogger.warn(`ModuleScanner: modulesPath equals project root — only scanning project root.`);
    }

    defaultLogger.info(`ModuleScanner: total ${descriptors.length} modules`);
    this.graph = new ModuleGraph().build(descriptors, projectRoot);

    const graphFile = writeMcpGraphFile(this.graph, os.tmpdir());
    const repoRoot = findRepoRoot();
    const mcpConfig = buildMcpServers({
      moduleName: this.graph.root,
      basePath: repoRoot,
      graphFile,
    });

    this.agentManager = new AgentManager(this.config, this.graph, mcpConfig, defaultLogger);
    this.agentRouter = new AgentRouter(this.agentManager, this.graph);
    this.currentAgent = this.graph.root;

    this.setStatus('idle');
  }

  setStreamHandler(handler: StreamHandler): void {
    this.streamHandler = handler;
    this.onSessionUpdate = handler.onSessionUpdate;
  }

  getCurrentAgent(): string {
    return this.currentAgent;
  }

  getAgentStatus(): AgentStatus {
    return this.status;
  }

  getGraph(): ModuleGraphType | null {
    return this.graph;
  }

  isModuleLoaded(name: string): boolean {
    return this.entries.has(name);
  }

  listAgents(): string[] {
    if (!this.graph) return [];
    return [...this.graph.nodes.keys()];
  }

  async startMainAgent(): Promise<void> {
    if (!this.agentManager) throw new Error('AgentService not initialized — call init() first');

    defaultLogger.info(`TUI: starting main agent`);
    const entry = await this.agentManager.startMainAgent(
      this.projectRoot,
      this.onSessionUpdate ?? undefined,
    );
    this.entries.set(this.graph!.root, entry);
  }

  async startModuleAgent(name: string): Promise<void> {
    if (!this.agentManager || !this.graph) {
      throw new Error('AgentService not initialized — call init() first');
    }

    const node = this.graph.nodes.get(name);
    if (!node) throw new Error(`Module "${name}" not found in graph`);

    defaultLogger.info(`TUI: starting module agent "${name}"`);
    const subDirs = getSubModuleDirs(
      node,
      this.graph,
      (n) => workspacePathForModule(n, null, this.projectRoot),
    );

    const entry = await this.agentManager.startModuleAgent(
      name,
      node.absolutePath,
      this.onSessionUpdate ?? undefined,
      subDirs,
    );
    this.entries.set(name, entry);
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.agentRouter) throw new Error('AgentService not initialized — call init() first');

    try {
      const name = this.currentAgent;
      let entry = this.entries.get(name);
      defaultLogger.info(`TUI send: agent="${name}" chars=${text.length} existing=${!!entry}`);
      if (!entry) {
        defaultLogger.info(`TUI send: starting ${name} agent first`);
        if (name === 'main' || (this.graph && name === this.graph.root)) {
          await this.startMainAgent();
        } else {
          await this.startModuleAgent(name);
        }
        entry = this.entries.get(name);
        if (!entry) throw new Error(`Failed to start agent "${name}"`);
      }

      this.setStatus('streaming');

      await this.agentRouter.sendToAgent(entry, text);
      defaultLogger.info(`TUI send: ${name} OK`);
      this.streamHandler?.onComplete();
      this.setStatus('idle');
    } catch (err) {
      defaultLogger.error(`TUI send: ${this.currentAgent} FAILED | ${(err as Error).message}`);
      this.setStatus('error');
      const message = `Error: ${(err as Error).message}`;
      this.streamHandler?.onError(message);
      this.onMessage({
        id: `error-${Date.now()}`,
        role: 'system',
        content: message,
        time: new Date().toLocaleTimeString(),
      });
    }
  }

  async cancel(): Promise<void> {
    defaultLogger.info(`TUI: cancel agent "${this.currentAgent}"`);
    const entry = this.entries.get(this.currentAgent);
    if (!entry || !this.agentRouter) return;

    try {
      await this.agentRouter.cancelAgent(entry);
    } catch {
      this.setStatus('idle');
    }
    this.setStatus('idle');
  }

  async setCurrentAgent(name: string): Promise<void> {
    if (!this.graph) throw new Error('AgentService not initialized — call init() first');

    if (!this.graph.nodes.has(name)) {
      throw new Error(`Module "${name}" not found in graph`);
    }

    const oldAgent = this.currentAgent;
    this.currentAgent = name;
    defaultLogger.info(`TUI: switch agent "${oldAgent}" → "${name}"`);

    const entry = this.entries.get(name);
    if (!entry) {
      if (name === 'main' || name === this.graph.root) {
        await this.startMainAgent();
      } else {
        await this.startModuleAgent(name);
      }
    }
  }

  async dispose(): Promise<void> {
    defaultLogger.info(`TUI: disposing agent service`);
    if (this.agentManager) {
      await this.agentManager.stopAll();
    }
    this.entries.clear();
    this.config = null;
    this.graph = null;
    this.agentManager = null;
    this.agentRouter = null;
    this.status = 'disconnected';
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    this.onStatusChange(status);
  }
}
