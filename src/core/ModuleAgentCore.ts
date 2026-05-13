import path from 'path';
import { defaultLogger, type Logger } from './Logger.js';
import { ModuleAgentSubsystem } from './ModuleAgentSubsystem.js';
import { RoleAgentSubsystem } from './RoleAgentSubsystem.js';
import { WorkflowSubsystem } from './WorkflowSubsystem.js';
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
// ModuleAgentCore 选项
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
  /** Optional workflow session-update listener */
  onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: SessionNotification) => void;
}

// ---------------------------------------------------------------------------
// ModuleAgentCore 核心类
// ---------------------------------------------------------------------------

export class ModuleAgentCore {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private basePath: string;
  private configDir: string;

  modules: ModuleAgentSubsystem;
  roles: RoleAgentSubsystem | null = null;
  workflows: WorkflowSubsystem | null = null;

  private projectRoot = '';
  private initialized = false;
  private onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;
  private onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: SessionNotification) => void;

  constructor(options: ModuleAgentCoreOptions) {
    this.callbacks = options.callbacks;
    this.basePath = options.basePath;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this.logger = options.logger || defaultLogger;
    this.onRoleSessionUpdate = options.onRoleSessionUpdate;
    this.onWorkflowSessionUpdate = options.onWorkflowSessionUpdate;

    this.modules = new ModuleAgentSubsystem({
      callbacks: this.callbacks,
      basePath: this.basePath,
      configDir: this.configDir,
      logger: this.logger,
      onSessionUpdate: options.onSessionUpdate,
    });

    if (options.enableRoles) {
      // 角色子系统需要 init 时设置的 projectPath 和 workspaceRoot
    }
  }

  // -----------------------------------------------------------------------
  // 生命周期
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
      onSessionUpdate: onSessionUpdate || this.onRoleSessionUpdate,
    });
  }

  /**
   * Initialize workflow subsystem. Must be called after init().
   */
  initWorkflows(
    projectPath: string,
    workspaceRoot: string,
    onSessionUpdate?: (agentName: string, sessionId: string, notification: SessionNotification) => void,
  ): void {
    if (!this.initialized) throw new Error('Must call init() before initWorkflows()');

    this.workflows = new WorkflowSubsystem({
      callbacks: this.callbacks,
      basePath: this.basePath,
      configDir: this.configDir,
      projectPath,
      workspaceRoot,
      logger: this.logger,
      onSessionUpdate: onSessionUpdate || this.onWorkflowSessionUpdate,
    });
  }

  async dispose(): Promise<void> {
    this.logger.info('ModuleAgentCore: disposing');
    await this.modules.dispose();
    if (this.roles) {
      await this.roles.dispose();
    }
    if (this.workflows) {
      await this.workflows.dispose();
    }
    this.initialized = false;
  }

  // -----------------------------------------------------------------------
  // Agent 交互（便捷包装）
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
  // 查询
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
  // 内部方法
  // -----------------------------------------------------------------------

  private _ensureInit(): void {
    if (!this.initialized) throw new Error('ModuleAgentCore not initialized — call init() first');
  }
}
