import { AgentManager, type AgentEntry } from '../../agents/AgentManager.js';
import { AgentRouter } from '../../agents/AgentRouter.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import type { ProjectConfig } from '../../config/defaults.js';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { StreamHandler } from './StreamHandler.js';
import type { ChatMessage, AgentStatus } from '../types.js';

export class AgentService {
  private projectRoot = '';
  private config: ProjectConfig | null = null;
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

    this.config = await ConfigLoader.load(projectRoot);
    const descriptors = await ModuleScanner.scan({
      projectRoot,
      extraExclude: this.config.exclude,
    });
    this.graph = new ModuleGraph().build(descriptors, projectRoot);

    this.agentManager = new AgentManager(this.config, this.graph, []);
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

  listAgents(): string[] {
    if (!this.graph) return [];
    return [...this.graph.nodes.keys()];
  }

  async startMainAgent(): Promise<void> {
    if (!this.agentManager) throw new Error('AgentService not initialized — call init() first');

    const entry = await this.agentManager.startMainAgent(
      this.projectRoot,
      this.onSessionUpdate ?? undefined,
    );
    this.entries.set('main', entry);
  }

  async startModuleAgent(name: string): Promise<void> {
    if (!this.agentManager || !this.graph) {
      throw new Error('AgentService not initialized — call init() first');
    }

    const node = this.graph.nodes.get(name);
    if (!node) throw new Error(`Module "${name}" not found in graph`);

    const entry = await this.agentManager.startModuleAgent(
      name,
      node.absolutePath,
      this.onSessionUpdate ?? undefined,
    );
    this.entries.set(name, entry);
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.agentRouter) throw new Error('AgentService not initialized — call init() first');

    const name = this.currentAgent;
    let entry = this.entries.get(name);
    if (!entry) {
      if (name === 'main' || (this.graph && name === this.graph.root)) {
        await this.startMainAgent();
      } else {
        await this.startModuleAgent(name);
      }
      entry = this.entries.get(name);
      if (!entry) throw new Error(`Failed to start agent "${name}"`);
    }

    this.onMessage({
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: text,
      time: new Date().toLocaleTimeString(),
    });

    this.setStatus('streaming');

    try {
      await this.agentRouter.sendToAgent(entry, text);
      this.streamHandler?.onComplete();
    } catch (err) {
      this.setStatus('error');
      const message = `Error: ${(err as Error).message}`;
      this.streamHandler?.onError(message);
      this.onMessage({
        id: `error-${Date.now()}`,
        role: 'system',
        content: message,
        time: new Date().toLocaleTimeString(),
      });
      return;
    }

    this.setStatus('idle');
  }

  async cancel(): Promise<void> {
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

    this.currentAgent = name;

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
