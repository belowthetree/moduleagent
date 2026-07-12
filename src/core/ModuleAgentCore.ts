// ---------------------------------------------------------------------------
// core/ModuleAgentCore.ts �?统一 Agent 编排核心
// 组合 ModuleAgentSubsystem、RoleAgentSubsystem、WorkflowSubsystem �?MCP 后端
// 提供统一的消息发送、Agent 管理和生命周期控�?// ---------------------------------------------------------------------------

import path from 'path';
import { defaultLogger, type Logger } from './Logger.js';
import { ModuleAgentSubsystem } from './ModuleAgentSubsystem.js';
import { RoleAgentSubsystem } from './RoleAgentSubsystem.js';
import { WorkflowSubsystem } from './WorkflowSubsystem.js';
import { CrossModuleRouter, type CrossModuleRouterCallbacks } from '../agents/mcp/McpBackend.js';
import type {
  CoreCallbacks,
  CoreStatus,
  CoreMessage,
  InitResult,
  AgentInfo,
} from './CoreTypes.js';
import type { RoleConfig } from '../config/defaults.js';
import type { PromptBlock } from '../agents/kernel/types.js';
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
  onSessionUpdate?: (moduleName: string, sessionId: string, notification: any) => void;
  /** Optional role session-update listener */
  onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  /** Optional workflow session-update listener */
  onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;
  /** Optional cross-context notification callback (for UI) */
  onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
  /** Optional post-send hook (summarizer + workspace diff) */
  onPostSend?: (moduleName: string, msgs: import('../types/shared.js').ChatMsg[], entry: import('./ModuleAgentSubsystem.js').AgentEntry) => void;
}

// ---------------------------------------------------------------------------
// ModuleAgentCore 核心�?// ---------------------------------------------------------------------------

export class ModuleAgentCore {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private basePath: string;
  private configDir: string;

  modules: ModuleAgentSubsystem;
  roles: RoleAgentSubsystem | null = null;
  workflows: WorkflowSubsystem | null = null;
  private crossModuleRouter: CrossModuleRouter | null = null;

  private projectRoot = '';
  private initialized = false;
  private onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  private onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;

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
      onPostSend: options.onPostSend,
    });

    if (options.enableRoles) {
      // 角色子系统需�?init 时设置的 projectPath �?workspaceRoot
    }
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  async init(projectRoot: string, configDir?: string): Promise<InitResult> {
    this.projectRoot = projectRoot;
    if (configDir) {
      this.configDir = configDir;
      this.modules.updateConfigDir(configDir);
    }
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
   * 完整初始化：扫描模块 + 加载角色 + 初始化工作流�?   * 替代手动调用 init() �?initRoles() �?initWorkflows() 的编排模式�?   */
  async initAll(projectRoot: string, configDir?: string): Promise<InitResult> {
    const result = await this.init(projectRoot, configDir);

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

      // 启动 MCP 后端（跨模块通信�?      await this.startMcpBackend();
    } catch (err) {
      this.logger.warn(`ModuleAgentCore: role/workflow init skipped: ${(err as Error).message}`);
    }

    return result;
  }

  /** 初始化跨模块通信路由器 */
  async startMcpBackend(): Promise<void> {
    if (this.crossModuleRouter) return;
    const callbacks: CrossModuleRouterCallbacks = {
      getAgentEntry: (moduleName) => {
        const entry = this.modules.getAgent(moduleName);
        return entry ? entry.agent : undefined;
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
        this.modules.setAgentStatus(moduleName, status);
        this.callbacks.onModuleStatusChange?.(moduleName, status);
      },
      startStream: (moduleName) => this.modules.startStream(moduleName),
      finishStream: (moduleName) => this.modules.finishStream(moduleName),
      saveCrossContext: async (moduleName, msgs) => {
        const existing = await this.modules.loadContext(moduleName);
        existing.push(...msgs);
        await this.modules.saveContext(moduleName, existing);
      },
      getModuleList: (requestingModule) => this.modules.getModuleListForBridge(requestingModule),
    };
    this.crossModuleRouter = new CrossModuleRouter(callbacks);
    this.modules.crossModuleRouter = this.crossModuleRouter;
    this.logger.info('ModuleAgentCore: cross-module router initialized');
  }

  /** 停止跨模块通信路由器 */
  async stopMcpBackend(): Promise<void> {
    this.crossModuleRouter = null;
    this.modules.crossModuleRouter = null;
  }

  /**
   * Initialize role agent subsystem. Must be called after init().
   * Only needed if enableRoles was not set in constructor.
   */
  initRoles(
    projectPath: string,
    workspaceRoot: string,
    onSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void,
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
      stateManager: this.modules.stateManager ?? undefined,
    });
  }

  /**
   * Initialize workflow subsystem. Must be called after init().
   */
  initWorkflows(
    projectPath: string,
    workspaceRoot: string,
    onSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void,
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

  async startAgent(moduleName: string): Promise<void> {
    this._ensureInit();
    await this.modules.startAgent(moduleName);
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

  getAgentCwd(moduleName: string): string | null {
    return this.modules.getAgentCwd(moduleName);
  }

  getWorkspaceCwd(moduleName: string): string | null {
    return this.modules.getWorkspaceCwd(moduleName);
  }

  getAgentModes(moduleName: string): { value: string; name: string; current: boolean }[] {
    return this.modules.getAgentModes(moduleName);
  }

  async setAgentMode(moduleName: string, modeValue: string): Promise<void> {
    await this.modules.setAgentMode(moduleName, modeValue);
  }

  getAgentModels(moduleName: string): { value: string; name: string; current: boolean }[] {
    return this.modules.getAgentModels(moduleName);
  }

  async setAgentModel(moduleName: string, modelValue: string): Promise<void> {
    await this.modules.setAgentModel(moduleName, modelValue);
  }

  setDefaultMode(modeValue: string): void {
    this.modules.setDefaultMode(modeValue);
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
    if (!this.initialized) throw new Error('ModuleAgentCore not initialized �?call init() first');
  }
}

