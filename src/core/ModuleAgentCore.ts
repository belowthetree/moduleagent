import path from 'path';
import { defaultLogger, type Logger } from './Logger.js';
import { ModuleAgentSubsystem } from './ModuleAgentSubsystem.js';
import { RoleAgentSubsystem } from './RoleAgentSubsystem.js';
import { WorkflowSubsystem } from './WorkflowSubsystem.js';
import { McpBackendServer, type McpBackendCallbacks } from '../agents/McpBackend.js';
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
  /** Optional cross-context notification callback (for UI) */
  onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
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
  private mcpBackend: McpBackendServer | null = null;

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
      onCrossContext: options.onCrossContext,
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
      this.initialized = true;
      return { moduleNames: [], rootAgent: '' };
    }
  }

  /**
   * 完整初始化：扫描模块 + 加载角色 + 初始化工作流。
   * 替代手动调用 init() → initRoles() → initWorkflows() 的编排模式。
   */
  async initAll(projectRoot: string): Promise<InitResult> {
    const result = await this.init(projectRoot);

    try {
      const { ConfigLoader } = await import('../config/ConfigLoader.js');
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      const resolvedProjectPath = config.projectPath || projectRoot;
      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

      const roles = workspaceConfig.roles;
      if (roles && roles.length > 0) {
        this.initRoles(resolvedProjectPath, workspaceRoot);
        this.logger.info(`ModuleAgentCore: auto-initialised ${roles.length} role(s)`);
      }

      this.initWorkflows(resolvedProjectPath, workspaceRoot);
      this.logger.info('ModuleAgentCore: auto-initialised workflow subsystem');

      // 启动 MCP 后端（跨模块通信）
      await this.startMcpBackend();
    } catch (err) {
      this.logger.warn(`ModuleAgentCore: role/workflow init skipped: ${(err as Error).message}`);
    }

    return result;
  }

  /** 启动 MCP HTTP 后端，使模块间可以通过 module_call/module_query 通信 */
  async startMcpBackend(): Promise<void> {
    if (this.mcpBackend) return;
    const callbacks: McpBackendCallbacks = {
      getAgentEntry: (moduleName) => {
        const entry = this.modules.getAgent(moduleName);
        if (!entry) return undefined;
        return { launched: { connection: entry.launched.connection, onSessionUpdate: entry.launched.onSessionUpdate }, sessionId: entry.sessionId };
      },
      startAgent: async (moduleName) => {
        await this.modules.startAgent(moduleName);
        return true;
      },
      buildPromptBlocks: (moduleName, userText) => this.modules.buildPromptBlocksForModule(moduleName, userText),
      sendCrossContext: (source, target, direction, phase, content) => {
        this.callbacks.onCrossModuleMessage?.(source, target, direction, phase, content);
      },
      setAgentStatus: (moduleName, status) => {
        this.callbacks.onModuleStatusChange?.(moduleName, status);
      },
    };
    this.mcpBackend = new McpBackendServer(callbacks);
    const port = await this.mcpBackend.start();
    this.modules.mcpBackendPort = port;
    this.logger.info(`ModuleAgentCore: MCP backend started on port ${port}`);
  }

  /** 停止 MCP 后端 */
  async stopMcpBackend(): Promise<void> {
    if (this.mcpBackend) {
      await this.mcpBackend.stop();
      this.mcpBackend = null;
      this.modules.mcpBackendPort = 0;
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
    await this.stopMcpBackend();
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

  async clearContext(moduleName?: string): Promise<void> {
    this._ensureInit();
    await this.modules.clearContext(moduleName);
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
