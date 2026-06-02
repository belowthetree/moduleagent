// ---------------------------------------------------------------------------
// agents/Agent.ts — 统一的 Agent 类
// 封装 agent 子进程完整生命周期：启动、session 管理、发送、取消、停止、清空上下文
// 内置状态机 + 对话队列：busy 时自动排队，idle 后自动消费
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
// AgentState — Agent 运行状态枚举
// ---------------------------------------------------------------------------

export enum AgentState {
  /** 空闲，可接受新消息 */
  Idle = 'idle',
  /** 正在启动子进程 / 创建 session */
  Starting = 'starting',
  /** 正在流式生成回复 */
  Streaming = 'streaming',
  /** 正在执行工具调用 */
  UsingTool = 'using_tool',
  /** 发生错误（可恢复） */
  Error = 'error',
  /** 已停止（子进程已杀死） */
  Stopped = 'stopped',
}

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

  /** 可选：状态变更回调 */
  onStateChange?: (newState: AgentState, oldState: AgentState) => void;

  /** 可选：消息排队回调（agent busy 时新消息进入队列触发） */
  onQueue?: (queueLength: number) => void;

  /** 可选：系统消息排队回调（permission 拒绝等触发），携带消息文本 */
  onSystemMessage?: (text: string, queueLength: number) => void;

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
// 内部：队列消息条目
// ---------------------------------------------------------------------------

interface QueuedItem {
  blocks: ContentBlock[];
  resolve: () => void;
  reject: (err: Error) => void;
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

  // ── 状态机 ──
  private _state: AgentState = AgentState.Starting;
  private _onStateChange?: (newState: AgentState, oldState: AgentState) => void;
  private _onQueue?: (queueLength: number) => void;
  private _onSystemMessage?: (text: string, queueLength: number) => void;

  // ── 对话队列 ──
  private _queue: QueuedItem[] = [];
  private _draining = false;

  private constructor(
    name: string,
    config: AgentConfig,
    cwd: string,
    launched: LaunchedAgent,
    sessionId: string,
    sessionResult: any,
    logger: Logger,
    buildMcpServers: (cwd: string) => McpServerStdio[],
    onStateChange?: (newState: AgentState, oldState: AgentState) => void,
    onQueue?: (queueLength: number) => void,
    onSystemMessage?: (text: string, queueLength: number) => void,
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
    this._onStateChange = onStateChange;
    this._onQueue = onQueue;
    this._onSystemMessage = onSystemMessage;
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

  /** 当前运行状态 */
  get state(): AgentState {
    return this._state;
  }

  /** 当前队列中的消息数量 */
  get queueLength(): number {
    return this._queue.length;
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
    const { name, config, cwd, launcher, buildMcpServers, onNotification, onStateChange } = options;

    // Agent 实例的间接引用（用于 onPermissionRejected 回调，在 Agent 构造后赋值）
    let agentRef: Agent | null = null;

    // 1. 启动子进程 + 建立 ACP 连接
    const launched = await launcher.launch(config, name, cwd, log, {
      subModuleDirs: options.subModuleDirs,
      createConnection: options.createConnection,
      onPermissionRejected: (toolName, reason) => {
        // 在 ACP 回调栈之外通过 queueMicrotask 安全入队
        const agent = agentRef;
        if (agent) {
          queueMicrotask(() => agent._enqueueSystemMessage(
            `[系统通知] 工具调用被拒绝\n` +
            `工具: ${toolName}\n` +
            `原因: ${reason}\n` +
            `请使用工作区内的路径重试。`,
          ));
        }
      },
    });

    // 打印 agent 能力
    const caps = launched.agentCapabilities;
    log.info(`[${name}] agent capabilities: ${JSON.stringify(caps)}`);
    const sessionCaps = (caps as any)?.sessionCapabilities;
    log.info(`[${name}] session capabilities: ${JSON.stringify(sessionCaps)}`);
    const hasResume = !!(sessionCaps?.resume);

    // 2. 构建 MCP 服务器
    const mcpServers = buildMcpServers(cwd);

    // 3. 创建或恢复 session
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

    // 4. 持久化 sessionId
    options.sessionResume?.save(sessionId);

    // 5. 构建 Agent 实例（初始状态 Starting）
    const agent = new Agent(name, config, cwd, launched, sessionId, sessionResult, log, buildMcpServers, onStateChange, options.onQueue, options.onSystemMessage);
    agentRef = agent; // 激活 onPermissionRejected 回调

    // 6. 连接 session 更新 → 内部状态机 + 外部回调
    //    使用 agentRef 间接引用，因为 launched.onSessionUpdate 在 Agent 构造后设置
    //    但 newSession 不会产生 stream 通知，所以安全
    launched.onSessionUpdate = (_agentName, _sid, notification) => {
      // try-catch 隔离：防止内部异常传播到 ACP SDK 导致流损坏
      try { agent._handleNotification(notification); } catch (err) {
        log.warn(`[${name}] _handleNotification error: ${(err as Error).message}`);
      }
      try { onNotification(_sid, notification); } catch (err) {
        log.warn(`[${name}] onNotification error: ${(err as Error).message}`);
      }
    };

    // 7. 启动完成 → idle
    agent._transition(AgentState.Idle);

    log.info(`Agent [${name}] ready, sessionId=${sessionId}`);
    return agent;
  }

  // -- 运行时操作 --

  /**
   * 发送提示块到 agent。
   * 如果 agent 当前 busy（streaming / using_tool / starting），消息自动排队；
   * agent 恢复 idle 后按 FIFO 顺序自动消费队列。
   */
  async send(blocks: ContentBlock[]): Promise<void> {
    if (this._state === AgentState.Stopped) {
      throw new Error(`Agent [${this.name}] is stopped`);
    }

    // 如果当前 busy，排队等待
    if (this._state !== AgentState.Idle && this._state !== AgentState.Error) {
      return new Promise<void>((resolve, reject) => {
        this._queue.push({ blocks, resolve, reject });
        const qlen = this._queue.length;
        this._logger.info(
          `Agent [${this.name}] queued message (state=${this._state}, queue=${qlen})`,
        );
        this._onQueue?.(qlen);
      });
    }

    // idle / error → 立即处理
    return this._processMessage(blocks);
  }

  /** 取消当前流式响应 */
  async cancel(): Promise<void> {
    try {
      await this._launched.connection.cancel({ sessionId: this._sessionId });
      this._logger.info(`Agent [${this.name}] cancelled`);
      // cancel 后 agent 回到 idle，触发队列消费
      this._transition(AgentState.Idle);
    } catch {
      // 忽略
    }
  }

  /** 停止 agent 子进程，清空队列并拒绝所有等待消息 */
  stop(): void {
    this._transition(AgentState.Stopped);
    try {
      this._launched.process.kill();
      this._logger.info(`Agent [${this.name}] stopped`);
    } catch {
      // 忽略
    }

    // 拒绝所有队列中的消息
    const drained = this._queue.splice(0);
    for (const item of drained) {
      item.reject(new Error(`Agent [${this.name}] stopped`));
    }
  }

  /**
   * 清空上下文：创建新 session（不杀进程）。
   * 返回新的 sessionId。
   * 如果 newSession 失败会抛出异常，调用者应处理回退逻辑。
   */
  async clearContext(mcpServers?: McpServerStdio[]): Promise<string> {
    this._transition(AgentState.Starting);
    try {
      const servers = mcpServers || this._buildMcpServers(this.cwd);
      const result = await this._launched.connection.newSession({
        cwd: this.cwd,
        mcpServers: servers,
      });
      this._sessionId = result.sessionId;
      this._sessionResult = result;
      this._logger.info(`Agent [${this.name}] new context session: ${result.sessionId}`);
      this._transition(AgentState.Idle);
      return result.sessionId;
    } catch (err) {
      this._transition(AgentState.Error);
      throw err;
    }
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

  // -----------------------------------------------------------------------
  // 内部：状态机
  // -----------------------------------------------------------------------

  /** 状态转换 + 日志 + 回调 */
  private _transition(newState: AgentState): void {
    const oldState = this._state;
    if (oldState === newState) return;
    this._state = newState;
    this._logger.info(`Agent [${this.name}] state: ${oldState} → ${newState}`);
    this._onStateChange?.(newState, oldState);

    // 回到 idle → 自动消费队列
    if (newState === AgentState.Idle && this._queue.length > 0) {
      this._drainQueue();
    }
  }

  /** 根据 ACP 通知更新运行状态 */
  private _handleNotification(notification: SessionNotification): void {
    const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
    const data = notification.update as Record<string, unknown>;

    if (update === 'tool_call') {
      const tc = data as { status?: string };
      if (tc.status === 'running') {
        this._transition(AgentState.UsingTool);
      }
    } else if (update === 'tool_call_update') {
      const tc = data as { status?: string };
      if (tc.status === 'completed' || tc.status === 'error') {
        // 工具执行完毕，回到 streaming（模型可能继续生成）
        if (this._state === AgentState.UsingTool) {
          this._transition(AgentState.Streaming);
        }
      }
    }
  }

  /**
   * 将文本作为系统消息直接推入内部队列（不经过 send()）。
   * 这是为 ACP 回调上下文（onSessionUpdate 内）设计的低开销路径，
   * 避免在 SDK 回调中分配 Promise 或触发状态检查影响流式传输。
   * 队列会在 agent 恢复 idle 后由 _drainQueue 自动消费。
   */
  private _enqueueSystemMessage(text: string): void {
    const blocks: ContentBlock[] = [{ type: 'text', text }];
    this._queue.push({
      blocks,
      resolve: () => {
        this._logger.info(
          `[${this.name}] system message delivered successfully`,
        );
      },
      reject: (err: Error) => {
        this._logger.warn(
          `[${this.name}] system message delivery failed: ${err.message}`,
        );
      },
    });
    this._logger.info(
      `[${this.name}] system message queued (state=${this._state}, queue=${this._queue.length})`,
    );
    // 延迟到下一个微任务触发回调，避免在 ACP onSessionUpdate 回调栈中
    // 执行可能触发 TUI 重渲染的同步操作（syncMessages 等），防止流损坏
    const cb = this._onSystemMessage;
    if (cb) {
      queueMicrotask(() => {
        try { cb(text, this._queue.length); } catch { /* ignore */ }
      });
    }
  }

  // -----------------------------------------------------------------------
  // 内部：消息处理 + 队列消费
  // -----------------------------------------------------------------------

  /** 处理单条消息（发送 → 等待完成 → 恢复 idle） */
  private async _processMessage(blocks: ContentBlock[]): Promise<void> {
    this._transition(AgentState.Streaming);
    try {
      await this._launched.connection.prompt({
        sessionId: this._sessionId,
        prompt: blocks,
      });
      this._transition(AgentState.Idle);
    } catch (err) {
      this._transition(AgentState.Error);
      throw err;
    }
  }

  /** 消费队列：idle + 队列非空时逐条处理 */
  private async _drainQueue(): Promise<void> {
    if (this._draining) return;
    this._draining = true;

    try {
      while (this._state === AgentState.Idle && this._queue.length > 0) {
        const item = this._queue.shift()!;
        this._logger.info(
          `Agent [${this.name}] draining queue (remaining=${this._queue.length})`,
        );
        try {
          await this._processMessage(item.blocks);
          item.resolve();
        } catch (err) {
          item.reject(err as Error);
          // 出错后尝试继续消费（如果状态允许）
        }
      }
    } finally {
      this._draining = false;
    }
  }
}
