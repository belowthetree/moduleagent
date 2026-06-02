// ---------------------------------------------------------------------------
// agents/Agent.ts — 统一的 Agent 类
// 封装 agent 子进程完整生命周期：启动、session 管理、发送、取消、停止、清空上下文
// 供 ModuleAgentSubsystem、RoleAgentManager、WorkflowManager 统一使用
// ---------------------------------------------------------------------------

import { AgentLauncher, type LaunchedAgent, type AgentConfig, type ConnectionFactory } from './AgentLauncher.js';
import type {
  ClientSideConnection,
  SessionNotification,
  McpServerStdio,
  ContentBlock,
  AgentCapabilities,
} from '@agentclientprotocol/sdk';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';

// ---------------------------------------------------------------------------
// AgentStartOptions — 启动注入点
// ---------------------------------------------------------------------------

export interface AgentStartOptions {
  /** Agent 名称（用于日志和识别） */
  name: string;
  /** Agent 子进程配置 */
  config: AgentConfig;
  /** 工作目录 */
  cwd: string;
  /** AgentLauncher 实例 */
  launcher: AgentLauncher;
  /** 日志器 */
  logger?: Logger;

  /** 子模块目录（用于文件系统隔离，仅模块 agent 需要） */
  subModuleDirs?: string[];

  /** 构建 MCP 服务器列表（各子系统提供各自的实现） */
  buildMcpServers: (cwd: string) => McpServerStdio[];

  /** 统一的 session 通知回调（各子系统在此分发 stream chunk / tool call 等） */
  onNotification: (sessionId: string, notification: SessionNotification) => void;

  /** 可选：session 恢复支持 */
  sessionResume?: {
    /** 上次保存的 sessionId */
    savedSessionId: string;
    /** 持久化当前 sessionId */
    save: (sessionId: string) => void;
  };

  /** 测试注入：替换 spawn 连接为内存 faux connection */
  createConnection?: ConnectionFactory;
}

// ---------------------------------------------------------------------------
// Agent 类
// ---------------------------------------------------------------------------

export class Agent {
  readonly name: string;
  readonly config: AgentConfig;
  readonly cwd: string;

  private _launched: LaunchedAgent;
  private _sessionId: string;
  private _logger: Logger;
  private _capabilities: AgentCapabilities | undefined;
  private _buildMcpServers: (cwd: string) => McpServerStdio[];
  private _sessionResult: any; // newSession / resumeSession 的原始响应

  private constructor(
    name: string,
    config: AgentConfig,
    cwd: string,
    launched: LaunchedAgent,
    sessionId: string,
    sessionResult: any,
    logger: Logger,
    buildMcpServers: (cwd: string) => McpServerStdio[],
  ) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this._launched = launched;
    this._sessionId = sessionId;
    this._sessionResult = sessionResult;
    this._logger = logger;
    this._capabilities = launched.agentCapabilities;
    this._buildMcpServers = buildMcpServers;
  }

  // -- 访问器 --

  get sessionId(): string {
    return this._sessionId;
  }

  get capabilities(): AgentCapabilities | undefined {
    return this._capabilities;
  }

  /** newSession / resumeSession 的原始响应（含 configOptions 等） */
  get sessionResult(): any {
    return this._sessionResult;
  }

  /** 底层的 ACP 连接（供子系统需要直接操作连接时使用） */
  get connection(): ClientSideConnection {
    return this._launched.connection;
  }

  /** 底层的 LaunchedAgent（供 McpBackend 等需要拦截 onSessionUpdate 时使用） */
  get launched(): LaunchedAgent {
    return this._launched;
  }

  // -- 工厂：启动 agent 子进程 + 创建 ACP 会话 --

  static async start(options: AgentStartOptions): Promise<Agent> {
    const log = options.logger || defaultLogger;
    const { name, config, cwd, launcher, buildMcpServers, onNotification } = options;

    // 1. 启动子进程 + 建立 ACP 连接
    const launched = await launcher.launch(config, name, cwd, log, {
      subModuleDirs: options.subModuleDirs,
      createConnection: options.createConnection,
    });

    // 打印 agent 能力
    const caps = launched.agentCapabilities;
    log.info(`[${name}] agent capabilities: ${JSON.stringify(caps)}`);
    const sessionCaps = (caps as any)?.sessionCapabilities;
    log.info(`[${name}] session capabilities: ${JSON.stringify(sessionCaps)}`);
    const hasResume = !!(sessionCaps?.resume);

    // 2. 连接 session 更新 → 统一回调
    launched.onSessionUpdate = (_agentName, sessionId, notification) => {
      onNotification(sessionId, notification);
    };

    // 3. 构建 MCP 服务器
    const mcpServers = buildMcpServers(cwd);

    // 4. 创建或恢复 session
    let sessionId: string;
    let sessionResult: any = null;

    const savedSessionId = options.sessionResume?.savedSessionId;
    if (hasResume && savedSessionId) {
      try {
        log.info(`[${name}] attempting session/resume id=${savedSessionId}`);
        sessionResult = await launched.connection.resumeSession!({
          sessionId: savedSessionId,
          cwd,
          mcpServers,
        });
        sessionId = savedSessionId;
        log.info(`[${name}] resumed session ${sessionId}`);
      } catch (err) {
        log.warn(`[${name}] resume failed, creating new session: ${(err as Error).message}`);
        sessionResult = await launched.connection.newSession({ cwd, mcpServers });
        sessionId = sessionResult.sessionId;
      }
    } else {
      if (savedSessionId && !hasResume) {
        log.info(`[${name}] agent doesn't support resume, creating new session`);
      }
      sessionResult = await launched.connection.newSession({ cwd, mcpServers });
      sessionId = sessionResult.sessionId;
    }

    // 5. 持久化 sessionId
    options.sessionResume?.save(sessionId);

    // 6. 构建 Agent 实例
    const agent = new Agent(name, config, cwd, launched, sessionId, sessionResult, log, buildMcpServers);

    log.info(`Agent [${name}] ready, sessionId=${sessionId}`);
    return agent;
  }

  // -- 运行时操作 --

  /** 发送提示块到 agent */
  async send(blocks: ContentBlock[]): Promise<void> {
    await this._launched.connection.prompt({
      sessionId: this._sessionId,
      prompt: blocks,
    });
  }

  /** 取消当前流式响应 */
  async cancel(): Promise<void> {
    try {
      await this._launched.connection.cancel({ sessionId: this._sessionId });
      this._logger.info(`Agent [${this.name}] cancelled`);
    } catch {
      // 忽略
    }
  }

  /** 停止 agent 子进程 */
  stop(): void {
    try {
      this._launched.process.kill();
      this._logger.info(`Agent [${this.name}] stopped`);
    } catch {
      // 忽略
    }
  }

  /**
   * 清空上下文：创建新 session（不杀进程）。
   * 返回新的 sessionId。
   * 如果 newSession 失败会抛出异常，调用者应处理回退逻辑。
   */
  async clearContext(mcpServers?: McpServerStdio[]): Promise<string> {
    const servers = mcpServers || this._buildMcpServers(this.cwd);
    const result = await this._launched.connection.newSession({
      cwd: this.cwd,
      mcpServers: servers,
    });
    this._sessionId = result.sessionId;
    this._sessionResult = result;
    this._logger.info(`Agent [${this.name}] new context session: ${result.sessionId}`);
    return result.sessionId;
  }

  /** 设置 session 配置选项（mode、model 等） */
  async setConfigOption(configId: string, value: string): Promise<void> {
    await this._launched.connection.setSessionConfigOption({
      sessionId: this._sessionId,
      configId,
      value,
    });
    this._logger.info(`Agent [${this.name}] config ${configId}=${value}`);
  }
}
