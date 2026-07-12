// ---------------------------------------------------------------------------
// RoleAgentManager.ts — 角色 Agent 生命周期管理器
// 负责角色 Agent 的启动/停止，管理工作空间、MCP 服务器和 ACP 会话
// ---------------------------------------------------------------------------

import { KernelFactory, type AgentConfig } from '../KernelFactory.js';
import { Agent } from '../Agent.js';
import path from 'path';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';
import type { RoleConfig } from '../../config/defaults.js';
import { AgentSandbox } from '../kernel/Sandbox.js';

// ---------------------------------------------------------------------------
// RoleAgentEntry 接口
// ---------------------------------------------------------------------------

export interface RoleAgentEntry {
  agent: Agent;
  workspacePath: string;
  roleConfig: RoleConfig;
}

// ---------------------------------------------------------------------------
// 构造函数选项
// ---------------------------------------------------------------------------

export interface RoleAgentManagerOptions {
  launcher: KernelFactory;
  basePath: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
    callbacks?: {
      onSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
    onQueue?: (queueLength: number) => void;
    onSystemMessage?: (text: string, queueLength: number) => void;
  };
}

// ---------------------------------------------------------------------------
// RoleAgentManager 核心类
// ---------------------------------------------------------------------------

export class RoleAgentManager {
  private launcher: KernelFactory;
  private basePath: string;
  private projectPath: string;
  private workspaceRoot: string;
  private logger: Logger;
  private callbacks?: RoleAgentManagerOptions['callbacks'];

  agents = new Map<string, RoleAgentEntry>();
  pendingStarts = new Map<string, Promise<RoleAgentEntry>>();

  constructor(options: RoleAgentManagerOptions) {
    this.launcher = options.launcher;
    this.basePath = options.basePath;
    this.projectPath = options.projectPath;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger || defaultLogger;
    this.callbacks = options.callbacks;
  }

  // -----------------------------------------------------------------------
  // 启动角色 Agent
  // -----------------------------------------------------------------------

  async startRoleAgent(role: RoleConfig): Promise<RoleAgentEntry> {
    const roleName = role.name;

    const existing = this.agents.get(roleName);
    if (existing) return existing;

    const pending = this.pendingStarts.get(roleName);
    if (pending) return pending;

    const promise = this._startRoleAgentInternal(role);
    this.pendingStarts.set(roleName, promise);

    try {
      const entry = await promise;
      return entry;
    } finally {
      this.pendingStarts.delete(roleName);
    }
  }

  // -----------------------------------------------------------------------
  // 停止角色 Agent / 停止全部
  // -----------------------------------------------------------------------

  async stopRoleAgent(roleName: string): Promise<void> {
    const entry = this.agents.get(roleName);
    if (entry) {
      entry.agent.stop();
      this.agents.delete(roleName);
      this.logger.info(`Role agent stopped: ${roleName}`);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.agents) {
      entry.agent.stop();
    }
    this.agents.clear();
    this.pendingStarts.clear();
  }

  // -----------------------------------------------------------------------
  // 查询辅助方法
  // -----------------------------------------------------------------------

  getAgent(roleName: string): RoleAgentEntry | undefined {
    return this.agents.get(roleName);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  // -----------------------------------------------------------------------
  // 内部启动管道
  // -----------------------------------------------------------------------

  private async _startRoleAgentInternal(role: RoleConfig): Promise<RoleAgentEntry> {
    const roleName = role.name;

    try {
      // 1. Resolve agent config
      const agentConfig: AgentConfig = {
        command: role.agents.default.command,
        args: role.agents.default.args,
      };

      // 2. Compute visibility from visible module paths
      const allowed = role.visibleModulePaths.length > 0
        ? role.visibleModulePaths.map(p => path.resolve(this.projectPath, p))
        : [this.projectPath];

      const sandbox = new AgentSandbox({ allowed, excluded: [] });

      this.logger.info(
        `startRoleAgent [${roleName}] cwd=${this.projectPath} visible=[${allowed.join(', ')}]`,
      );

      // 3. Build onNotification callback
      const self = this;
      const onNotification = (sessionId: string, notification: any): void => {
        if (self.callbacks?.onSessionUpdate) {
          self.callbacks.onSessionUpdate(roleName, sessionId, notification);
        }
      };

      // 4. Build MCP servers factory for kernel bridge
      const graphFile = path.join(this.projectPath, '.module-agent', 'mcp-graph.json');

      // 5. Start agent via unified Agent class
      const agent = await Agent.start({
        name: `workrole:${roleName}`,
        config: agentConfig,
        cwd: this.projectPath,
        launcher: this.launcher,
        logger: this.logger,
        sandbox,
        onNotification,
        onQueue: self.callbacks?.onQueue,
        onSystemMessage: self.callbacks?.onSystemMessage,
      });

      // 6. Build and store entry
      const entry: RoleAgentEntry = {
        agent,
        workspacePath: this.projectPath,
        roleConfig: role,
      };
      this.agents.set(roleName, entry);

      this.logger.info(`startRoleAgent [${roleName}] started, sessionId=${agent.sessionId}`);
      return entry;
    } catch (err) {
      this.logger.error(`startRoleAgent [${roleName}] failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // 角色配置解析
  // -----------------------------------------------------------------------

  resolveRoleConfig(role: RoleConfig): AgentConfig {
    return {
      command: role.agents.default.command,
      args: role.agents.default.args,
    };
  }
}
