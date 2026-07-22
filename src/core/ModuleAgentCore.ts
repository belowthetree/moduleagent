// ---------------------------------------------------------------------------
// core/ModuleAgentCore.ts — 统一 Agent 编排核心
// 组合 ModuleAgentSubsystem、RoleAgentSubsystem、WorkflowSubsystem 与 MCP 后端
// 提供统一的消息发送、Agent 管理和生命周期控制
// ---------------------------------------------------------------------------

import path from 'path';
import { defaultLogger, type Logger } from './Logger.js';
import { ModuleAgentSubsystem } from './ModuleAgentSubsystem.js';
import { RoleAgentSubsystem } from './RoleAgentSubsystem.js';
import { WorkflowSubsystem } from './WorkflowSubsystem.js';
import { CrossModuleRouter, type CrossModuleRouterCallbacks } from '../agents/mcp/McpBackend.js';
import type { AgentConfig } from '../agents/KernelFactory.js';
import type {
  CoreCallbacks,
  CoreStatus,
  InitResult,
  AgentInfo,
} from './CoreTypes.js';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';

// ---------------------------------------------------------------------------
// ModuleAgentCore 选项
// ---------------------------------------------------------------------------

/** 跨模块上下文装饰钩子（Electron 用于 timeline 装饰，TUI 无此逻辑） */
export type CrossModuleContextHook = (info: {
  fromModule: string;
  toModule: string;
  direction: 'sent' | 'received';
  phase: 'request' | 'response';
  content: string;
}) => void;

export interface ModuleAgentCoreOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  logger?: Logger;
  /** Optional external session-update listener (e.g. SessionStore in Electron) */
  onSessionUpdate?: (moduleName: string, sessionId: string, notification: any) => void;
  /** Optional role session-update listener */
  onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  /** Optional workflow session-update listener */
  onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;
  /** Optional cross-context notification callback (for UI) */
  onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
  /** Optional post-send hook (summarizer + workspace diff) */
  onPostSend?: (moduleName: string, msgs: import('../types/shared.js').ChatMsg[], entry: import('./ModuleAgentSubsystem.js').AgentEntry) => void;
  /** 忽略配置中的 projectPath，以当前 projectRoot 作为项目源码根目录（TUI 使用） */
  ignoreConfigProjectPath?: boolean;
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
  private crossModuleRouter: CrossModuleRouter | null = null;

  private projectRoot = '';
  private initialized = false;
  private ignoreConfigProjectPath: boolean;
  private onRoleSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  private onWorkflowSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;
  /** 跨模块上下文装饰钩子（由 initAll/startMcpBackend 的可选参数注入） */
  private onCrossModuleContext?: CrossModuleContextHook;

  constructor(options: ModuleAgentCoreOptions) {
    this.callbacks = options.callbacks;
    this.basePath = options.basePath;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this.logger = options.logger || defaultLogger;
    this.ignoreConfigProjectPath = options.ignoreConfigProjectPath ?? false;
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
      ignoreConfigProjectPath: this.ignoreConfigProjectPath,
    });
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
      // 扫描失败回落空图保持应用可用，但把错误如实上报（UI 可提示用户）
      const error = err as Error;
      this.logger.warn(`Core init: module scan failed (no modules?): ${error.message}`);
      this.callbacks.onError?.(
        `模块扫描失败，已回退为空模块图: ${error.message}`,
        error,
      );
      this.initialized = true;
      return { moduleNames: [], rootAgent: '' };
    }
  }

  /**
   * 完整初始化：扫描模块 + 加载角色 + 初始化工作流子系统。
   * 替代手动调用 init() → initRoles() → initWorkflows() 的编排模式。
   *
   * @param options.onCrossModuleContext 可选的跨模块上下文装饰钩子，
   *   在每次跨模块请求/响应时触发（Electron 用于 timeline 装饰）。
   */
  async initAll(
    projectRoot: string,
    configDir?: string,
    options?: { onCrossModuleContext?: CrossModuleContextHook },
  ): Promise<InitResult> {
    const result = await this.init(projectRoot, configDir);

    try {
      const { ConfigLoader } = await import('../config/ConfigLoader.js');
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      const resolvedProjectPath = this.ignoreConfigProjectPath
        ? projectRoot
        : (config.projectPath || projectRoot);
      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');

      const roles = workspaceConfig.roles;
      if (roles && roles.length > 0) {
        this.initRoles(resolvedProjectPath, workspaceRoot);
        this.logger.info(`ModuleAgentCore: auto-initialised ${roles.length} role(s)`);
      }

      this.initWorkflows(resolvedProjectPath, workspaceRoot);
      this.logger.info('ModuleAgentCore: auto-initialised workflow subsystem');
    } catch (err) {
      this.logger.warn(`ModuleAgentCore: role/workflow init skipped: ${(err as Error).message}`);
    }

    // MCP 后端必须初始化，与 role/workflow 无关
    await this.startMcpBackend({ onCrossModuleContext: options?.onCrossModuleContext });

    return result;
  }

  /** 初始化跨模块通信路由器 */
  async startMcpBackend(options?: { onCrossModuleContext?: CrossModuleContextHook }): Promise<void> {
    if (this.crossModuleRouter) return;
    if (options?.onCrossModuleContext) {
      this.onCrossModuleContext = options.onCrossModuleContext;
    }
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
        // 先走装饰钩子（Electron timeline 装饰），再走普通回调
        this.onCrossModuleContext?.({ fromModule: source, toModule: target, direction, phase, content });
        this.callbacks.onCrossModuleMessage?.(source, target, direction, phase, content);
      },
      setAgentStatus: (moduleName, status) => {
        this.modules.setAgentStatus(moduleName, status);
        this.callbacks.onModuleStatusChange?.(moduleName, status);
      },
      // 跨模块上下文直接落盘（不经过目标模块的活跃流累积器）
      appendCrossContext: (moduleName, requestText, responseText) =>
        this.modules.appendCrossContext(moduleName, requestText, responseText),
      getModuleList: (requestingModule) => this.modules.getModuleListForBridge(requestingModule),
    };
    this.crossModuleRouter = new CrossModuleRouter(callbacks, this.modules.crossModuleLimits);
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
      ...this._contextPipelineOptions(),
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
      defaultAgentConfig: this._defaultAgentConfig(),
      ...this._contextPipelineOptions(),
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

  /** 获取已扫描的模块图（init/initAll 完成后可用，避免调用方重复扫描） */
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

  async setAgentMode(moduleName: string, modeValue: string): Promise<boolean> {
    return this.modules.setAgentMode(moduleName, modeValue);
  }

  getAgentModels(moduleName: string): { value: string; name: string; current: boolean }[] {
    return this.modules.getAgentModels(moduleName);
  }

  async setAgentModel(moduleName: string, modelValue: string): Promise<boolean> {
    return this.modules.setAgentModel(moduleName, modelValue);
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

  /**
   * 从主配置解析上下文管理管道（snip→compact→truncate + 存档目录），
   * 供角色/工作流子系统的 agent 复用与模块 agent 相同的保护。
   */
  private _contextPipelineOptions(): {
    truncation?: import('../agents/kernel/types.js').AgentLoopConfig['truncation'];
    compaction?: import('../agents/kernel/types.js').AgentLoopConfig['compaction'];
    archiveDirFor: (agentName: string) => string;
  } {
    const config = this.modules.getConfig();
    return {
      truncation: config?.truncation,
      compaction: config?.compaction,
      archiveDirFor: (agentName: string) => path.join(
        this.projectRoot,
        '.module-agent',
        'archives',
        agentName.replace(/[<>:"/\\|?*]/g, '_'),
      ),
    };
  }

  /** 从主配置 agents.default 解析项目级默认 agent 配置（工作流步骤 agent 使用） */
  private _defaultAgentConfig(): AgentConfig | undefined {
    const def = this.modules.getConfig()?.agents.default;
    if (!def) return undefined;
    return {
      provider: def.provider,
      apiKey: def.apiKey,
      baseUrl: def.baseUrl,
      model: def.model,
      maxTokens: def.maxTokens,
      fastModel: def.fastModel,
      contextWindow: def.contextWindow,
    };
  }

  private _ensureInit(): void {
    if (!this.initialized) throw new Error('ModuleAgentCore not initialized — call init() first');
  }
}
