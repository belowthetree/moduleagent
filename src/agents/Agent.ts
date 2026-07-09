// ---------------------------------------------------------------------------
// agents/Agent.ts — 统一的 Agent 类
// 封装 agent 完整生命周期：启动、session 管理、发送、取消、停止、清空上下文
// 支持两种模式：ACP 子进程（默认）和 kernel 进程内代理
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
import { AgentKernel, type KernelNotification } from './kernel/index.js';

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

  /** kernel 模式：使用进程内代理内核替代 ACP 子进程 */
  useKernel?: boolean;

  /** kernel 模式：系统提示词 */
  systemPrompt?: string;

  /** kernel 模式：MCP 模块名称 */
  kernelModuleName?: string;
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

  private _launched: LaunchedAgent | null = null;
  private _kernel: AgentKernel | null = null;
  private _useKernel: boolean;
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
    sessionId: string,
    sessionResult: any,
    logger: Logger,
    buildMcpServers: (cwd: string) => McpServerStdio[],
    useKernel: boolean,
    onStateChange?: (newState: AgentState, oldState: AgentState) => void,
    onQueue?: (queueLength: number) => void,
    onSystemMessage?: (text: string, queueLength: number) => void,
  ) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this._sessionId = sessionId;
    this._sessionResult = sessionResult;
    this._logger = logger;
    this._buildMcpServers = buildMcpServers;
    this._useKernel = useKernel;
    this._onStateChange = onStateChange;
    this._onQueue = onQueue;
    this._onSystemMessage = onSystemMessage;
  }

  // -- 访问器 --

  get sessionId(): string {
    if (this._useKernel && this._kernel) {
      return this._kernel.sessionId;
    }
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
    return this._launched!.connection;
  }

  /** 底层的 LaunchedAgent（供 McpBackend 等需要拦截 onSessionUpdate 时使用） */
  get launched(): LaunchedAgent {
    return this._launched!;
  }

  /** kernel 实例（仅在 kernel 模式下可用） */
  get kernel(): AgentKernel | null {
    return this._kernel;
  }

  /** 是否使用 kernel 模式 */
  get useKernel(): boolean {
    return this._useKernel;
  }

  // -- 工厂：启动 agent 子进程 + 创建 ACP 会话 --

  static async start(options: AgentStartOptions): Promise<Agent> {
    const log = options.logger || defaultLogger;
    const { name, config, cwd, launcher, buildMcpServers, onNotification, onStateChange } = options;
    const useKernel = options.useKernel ?? config.kernel ?? false;

    if (useKernel) {
      return Agent._startKernel(options);
    }

    // Agent 实例的间接引用（用于 onPermissionRejected 回调，在 Agent 构造后赋值）
    let agentRef: Agent | null = null;

    // 1. 启动子进程 + 建立 ACP 连接
    const launched = await launcher.launch(config, name, cwd, log, {
      subModuleDirs: options.subModuleDirs,
      createConnection: options.createConnection,
      onPermissionRejected: (toolName, reason) => {
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
    const agent = new Agent(name, config, cwd, sessionId, sessionResult, log, buildMcpServers, false, onStateChange, options.onQueue, options.onSystemMessage);
    agent._launched = launched;
    agent._capabilities = launched.agentCapabilities;
    agentRef = agent;

    // 6. 连接 session 更新 → 内部状态机 + 外部回调
    launched.onSessionUpdate = (_agentName, _sid, notification) => {
      try { agent._handleNotification(notification); } catch (err) {
        log.warn(`[${name}] _handleNotification error: ${(err as Error).message}`);
      }
      try { onNotification(_sid, notification); } catch (err) {
        log.warn(`[${name}] onNotification error: ${(err as Error).message}`);
      }
    };

    // 7. 启动完成 → idle
    agent._transition(AgentState.Idle);

    log.info(`Agent [${name}] ready (ACP mode), sessionId=${sessionId}`);
    return agent;
  }

  private static async _startKernel(options: AgentStartOptions): Promise<Agent> {
    const log = options.logger || defaultLogger;
    const { name, config, cwd, launcher, onNotification, onStateChange, buildMcpServers } = options;

    const systemPrompt = options.systemPrompt || '';

    const kernel = await launcher.launchKernel(config, name, cwd, systemPrompt, log, {
      moduleName: options.kernelModuleName || name,
    });

    const sessionId = kernel.sessionId;

    // 创建虚拟 sessionResult 以兼容现有代码
    const sessionResult: any = {
      sessionId,
      configOptions: {},
    };

    const agent = new Agent(name, config, cwd, sessionId, sessionResult, log, buildMcpServers, true, onStateChange, options.onQueue, options.onSystemMessage);
    agent._kernel = kernel;
    agent._capabilities = undefined;

    // 连接 kernel 通知 → 内部状态机 + 外部回调
    kernel.onNotification((notif: KernelNotification) => {
      const notification = {
        sessionId: notif.sessionId,
        update: notif.update,
      } as SessionNotification;

      try { agent._handleKernelNotification(notif); } catch (err) {
        log.warn(`[${name}] kernel _handleNotification error: ${(err as Error).message}`);
      }
      try { onNotification(notif.sessionId, notification); } catch (err) {
        log.warn(`[${name}] kernel onNotification error: ${(err as Error).message}`);
      }
    });

    // 使用 buildMcpServers 来初始化 MCP 桥接（通过 kernel 的工具注册机制）
    // 注意：MCP 工具的详细桥接由 kernel/tools/mcp-bridge.ts 处理

    agent._transition(AgentState.Idle);

    log.info(`Agent [${name}] ready (kernel mode), sessionId=${sessionId}, model=${kernel.getModel()}`);
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

    return this._processMessage(blocks);
  }

  async cancel(): Promise<'cancelled' | 'stopped'> {
    if (this._useKernel && this._kernel) {
      this._kernel.cancel();
      this._logger.info(`Agent [${this.name}] kernel cancelled`);
      return 'cancelled';
    }

    this._logger.info(`Agent [${this.name}] stopping process (cancel not supported reliably via ACP)`);
    this.stop();
    return 'stopped';
  }

  /** 停止 agent，清空队列并拒绝所有等待消息 */
  stop(): void {
    this._transition(AgentState.Stopped);

    if (this._useKernel && this._kernel) {
      this._kernel.stop();
      this._logger.info(`Agent [${this.name}] kernel stopped`);
    }

    if (this._launched) {
      try {
        this._launched.process.kill();
        this._logger.info(`Agent [${this.name}] ACP process stopped`);
      } catch {
        // 忽略
      }
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
   */
  async clearContext(mcpServers?: McpServerStdio[]): Promise<string> {
    this._transition(AgentState.Starting);

    if (this._useKernel && this._kernel) {
      try {
        this._kernel.clearContext(true);
        this._sessionId = this._kernel.sessionId;
        this._logger.info(`Agent [${this.name}] kernel context cleared: ${this._sessionId}`);
        this._transition(AgentState.Idle);
        return this._sessionId;
      } catch (err) {
        this._transition(AgentState.Error);
        throw err;
      }
    }

    try {
      const servers = mcpServers || this._buildMcpServers(this.cwd);
      const result = await this._launched!.connection.newSession({
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
    if (this._useKernel) {
      this._logger.info(`Agent [${this.name}] kernel mode: config ${configId}=${value} (ignored)`);
      return;
    }
    await this._launched!.connection.setSessionConfigOption({
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

  /** 处理 kernel 通知，更新状态机 */
  private _handleKernelNotification(notification: KernelNotification): void {
    const update = notification.update.sessionUpdate;

    if (update === 'tool_call') {
      const status = notification.update.status as string | undefined;
      if (status === 'running') {
        this._transition(AgentState.UsingTool);
      }
    } else if (update === 'tool_call_update') {
      const status = notification.update.status as string | undefined;
      if (status === 'completed' || status === 'error') {
        if (this._state === AgentState.UsingTool) {
          this._transition(AgentState.Streaming);
        }
      }
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
        if (this._state === AgentState.UsingTool) {
          this._transition(AgentState.Streaming);
        }
      }
    }
  }

  /**
   * 将文本作为系统消息直接推入内部队列（不经过 send()）。
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

    if (this._useKernel && this._kernel) {
      try {
        await this._kernel.send(blocks as any);
        this._transition(AgentState.Idle);
      } catch (err) {
        this._transition(AgentState.Error);
        throw err;
      }
      return;
    }

    try {
      await this._launched!.connection.prompt({
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
        }
      }
    } finally {
      this._draining = false;
    }
  }
}
