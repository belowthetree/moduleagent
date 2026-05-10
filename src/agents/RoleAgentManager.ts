import { AgentLauncher, type LaunchedAgent, type AgentConfig } from './AgentLauncher.js';
import path from 'path';
import fs from 'fs';
import type { SessionNotification, McpServerStdio, ContentBlock } from '@agentclientprotocol/sdk';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';
import type { RoleConfig } from '../config/defaults.js';
import { prepareRoleWorkspace } from './RoleWorkspace.js';

// ---------------------------------------------------------------------------
// RoleAgentEntry 接口
// ---------------------------------------------------------------------------

export interface RoleAgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  workspacePath: string;
  roleConfig: RoleConfig;
}

// ---------------------------------------------------------------------------
// 构造函数选项
// ---------------------------------------------------------------------------

export interface RoleAgentManagerOptions {
  launcher: AgentLauncher;
  basePath: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  callbacks?: {
    onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;
  };
}

// ---------------------------------------------------------------------------
// RoleAgentManager 核心类
// ---------------------------------------------------------------------------

export class RoleAgentManager {
  private launcher: AgentLauncher;
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
      try { entry.launched.process.kill(); } catch { /* 忽略 */ }
      this.agents.delete(roleName);
      this.logger.info(`Role agent stopped: ${roleName}`);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.agents) {
      try { entry.launched.process.kill(); } catch { /* 忽略 */ }
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
    let launched: LaunchedAgent | null = null;

    try {
      // 1. Resolve agent config
      const agentConfig: AgentConfig = {
        command: role.agents.default.command,
        args: role.agents.default.args,
      };

      // 2. Prepare workspace
      const workspacePath = await prepareRoleWorkspace({
        roleName,
        visibleModulePaths: role.visibleModulePaths,
        projectPath: this.projectPath,
        workspaceRoot: this.workspaceRoot,
      });

      // 3. Launch agent subprocess (no subModuleDirs for role agents)
      this.logger.info(
        `startRoleAgent [${roleName}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${workspacePath}`,
      );
      launched = await this.launcher.launch(agentConfig, `workrole:${roleName}`, workspacePath, this.logger);

      // 4. Wire session-update callback
      launched.onSessionUpdate = (name, sessionId, notification) => {
        if (this.callbacks?.onSessionUpdate) {
          this.callbacks.onSessionUpdate(roleName, sessionId, notification);
        }
      };

      // 5. Build role-specific MCP servers
      const mcpServers = this._buildRoleMcpServers(workspacePath);

      // 6. Create ACP session
      const result = await launched.connection.newSession({ cwd: workspacePath, mcpServers });
      const sessionId = result.sessionId;

      // 7. Build and store entry
      const entry: RoleAgentEntry = {
        name: roleName,
        config: agentConfig,
        launched,
        sessionId,
        workspacePath,
        roleConfig: role,
      };
      this.agents.set(roleName, entry);

      this.logger.info(`startRoleAgent [${roleName}] started, sessionId=${sessionId}`);
      return entry;
    } catch (err) {
      if (launched) {
        try { launched.process.kill(); } catch { /* ignore */ }
      }
      this.logger.error(`startRoleAgent [${roleName}] failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // 为角色 Agent 构建 MCP 服务器
  // -----------------------------------------------------------------------

  private _buildRoleMcpServers(workspacePath: string): McpServerStdio[] {
    const bundlePath = path.join(this.basePath, 'dist', 'mcp-role-server.cjs');
    if (!fs.existsSync(bundlePath)) {
      this.logger.warn(`Role MCP server bundle not found: ${bundlePath}. Run: npm run build:mcp-role-server`);
      return [];
    }

    const servers: McpServerStdio[] = [{
      name: 'role-agent',
      command: 'node',
      args: [bundlePath, '--workspace', workspacePath],
      env: [],
    }];

    this.logger.info('Role MCP servers:');
    for (const s of servers) {
      this.logger.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
    }

    return servers;
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
