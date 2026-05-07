import path from 'path';
import { defaultLogger, type Logger } from './Logger.js';
import { ModuleAgentSubsystem } from './ModuleAgentSubsystem.js';
import { RoleAgentSubsystem } from './RoleAgentSubsystem.js';
import type {
  CoreCallbacks,
  CoreStatus,
  CoreMessage,
  InitResult,
  AgentInfo,
} from './CoreTypes.js';
import type { RoleConfig } from '../config/defaults.js';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';

// ---------------------------------------------------------------------------
// ModuleAgentCore options
// ---------------------------------------------------------------------------

export interface ModuleAgentCoreOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  logger?: Logger;
  /** Enable role agent support */
  enableRoles?: boolean;
  /** Optional external session-update listener (e.g. AgentStateManager in Electron) */
  onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void;
  /** Optional role session-update listener */
  onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;
}

// ---------------------------------------------------------------------------
// ModuleAgentCore
// ---------------------------------------------------------------------------

export class ModuleAgentCore {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private basePath: string;
  private configDir: string;

  modules: ModuleAgentSubsystem;
  roles: RoleAgentSubsystem | null = null;

  private projectRoot = '';
  private initialized = false;

  constructor(options: ModuleAgentCoreOptions) {
    this.callbacks = options.callbacks;
    this.basePath = options.basePath;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this.logger = options.logger || defaultLogger;

    this.modules = new ModuleAgentSubsystem({
      callbacks: this.callbacks,
      basePath: this.basePath,
      configDir: this.configDir,
      logger: this.logger,
      onSessionUpdate: options.onSessionUpdate,
    });

    if (options.enableRoles) {
      // Role subsystem needs projectPath and workspaceRoot which are set at init time
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async init(projectRoot: string): Promise<InitResult> {
    this.projectRoot = projectRoot;
    try {
      const result = await this.modules.init(projectRoot);
      this.initialized = true;
      return result;
    } catch (err) {
      this.logger.warn(`Core init: module scan failed (no modules?): ${(err as Error).message}`);
      this.initialized = true; // Still mark as initialized so roles can work
      return { moduleNames: [], rootAgent: '' };
    }
  }

  /**
   * Initialize role agent subsystem. Must be called after init().
   * Only needed if enableRoles was not set in constructor.
   */
  initRoles(
    projectPath: string,
    workspaceRoot: string,
    onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void,
  ): void {
    if (!this.initialized) throw new Error('Must call init() before initRoles()');

    this.roles = new RoleAgentSubsystem({
      callbacks: this.callbacks,
      basePath: this.basePath,
      configDir: this.configDir,
      projectPath,
      workspaceRoot,
      logger: this.logger,
      onSessionUpdate,
    });
  }

  async dispose(): Promise<void> {
    this.logger.info('ModuleAgentCore: disposing');
    await this.modules.dispose();
    if (this.roles) {
      await this.roles.dispose();
    }
    this.initialized = false;
  }

  // -----------------------------------------------------------------------
  // Agent interaction (convenience wrappers)
  // -----------------------------------------------------------------------

  async sendMessage(text: string, moduleName?: string): Promise<void> {
    this._ensureInit();
    await this.modules.sendMessage(text, moduleName);
  }

  async cancel(): Promise<void> {
    await this.modules.cancel();
  }

  async setCurrentAgent(name: string): Promise<void> {
    this._ensureInit();
    await this.modules.setCurrentAgent(name);
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getGraph(): ModuleGraphType | null {
    return this.modules.getGraph();
  }

  getCurrentAgent(): string {
    return this.modules.getCurrentAgent();
  }

  getAgentList(): AgentInfo[] {
    return this.modules.listAgents().map(name => ({
      name,
      status: 'idle' as CoreStatus,
    }));
  }

  getModuleNames(): string[] {
    return this.modules.listAgents();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _ensureInit(): void {
    if (!this.initialized) throw new Error('ModuleAgentCore not initialized — call init() first');
  }
}
