// ---------------------------------------------------------------------------
// agents/Agent.ts — 统一的 Agent 类
// 封装 agent 完整生命周期：启动、session 管理、发送、取消、停止、清空上下文
// 使用进程内 AgentKernel，所有操作均为进程内执行
// 内置状态机 + 对话队列：busy 时自动排队，idle 后自动消费
// ---------------------------------------------------------------------------

import { KernelFactory, type AgentConfig } from './KernelFactory.js';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';
import { AgentKernel, type KernelNotification, type PromptBlock, AgentSandbox } from './kernel/index.js';

// ---------------------------------------------------------------------------
// AgentState — Agent 运行状态枚举
// ---------------------------------------------------------------------------

export enum AgentState {
  Idle = 'idle',
  Starting = 'starting',
  Streaming = 'streaming',
  UsingTool = 'using_tool',
  Error = 'error',
  Stopped = 'stopped',
}

// ---------------------------------------------------------------------------
// AgentStartOptions — 启动注入点
// ---------------------------------------------------------------------------

export interface AgentStartOptions {
  name: string;
  config: AgentConfig;
  cwd: string;
  launcher: KernelFactory;
  logger?: Logger;
  subModuleDirs?: string[];
  sandbox?: AgentSandbox;
  onNotification: (sessionId: string, notification: any) => void;
  onStateChange?: (newState: AgentState, oldState: AgentState) => void;
  onQueue?: (queueLength: number) => void;
  onSystemMessage?: (text: string, queueLength: number) => void;
  sessionResume?: {
    savedSessionId: string;
    save: (sessionId: string) => void;
  };
  systemPrompt?: string;
  kernelModuleName?: string;
  crossModuleRouter?: import('./mcp/McpBackend.js').CrossModuleRouter;
}

// ---------------------------------------------------------------------------
// 内部：队列消息条目
// ---------------------------------------------------------------------------

interface QueuedItem {
  blocks: PromptBlock[];
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

  private _kernel: AgentKernel | null = null;
  private _sessionId: string;
  private _logger: Logger;
  private _sessionResult: any;

  private _state: AgentState = AgentState.Starting;
  private _onStateChange?: (newState: AgentState, oldState: AgentState) => void;
  private _onQueue?: (queueLength: number) => void;
  private _onSystemMessage?: (text: string, queueLength: number) => void;

  private _queue: QueuedItem[] = [];
  private _draining = false;

  private constructor(
    name: string,
    config: AgentConfig,
    cwd: string,
    sessionId: string,
    sessionResult: any,
    logger: Logger,
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
    this._onStateChange = onStateChange;
    this._onQueue = onQueue;
    this._onSystemMessage = onSystemMessage;
  }

  get sessionId(): string {
    if (this._kernel) {
      return this._kernel.sessionId;
    }
    return this._sessionId;
  }

  get sessionResult(): any {
    return this._sessionResult;
  }

  get state(): AgentState {
    return this._state;
  }

  get queueLength(): number {
    return this._queue.length;
  }

  get kernel(): AgentKernel | null {
    return this._kernel;
  }

  static async start(options: AgentStartOptions): Promise<Agent> {
    const log = options.logger || defaultLogger;
    const { name, config, cwd, launcher, onNotification, onStateChange } = options;

    const systemPrompt = options.systemPrompt || '';

    const kernel = await launcher.create(config, name, cwd, systemPrompt, log, {
      crossModuleRouter: options.crossModuleRouter,
      requestingModule: options.kernelModuleName || name,
      sandbox: options.sandbox,
    });

    const sessionId = kernel.sessionId;

    const sessionResult: any = {
      sessionId,
      configOptions: [],
    };

    const agent = new Agent(
      name, config, cwd, sessionId, sessionResult, log,
      onStateChange, options.onQueue, options.onSystemMessage,
    );
    agent._kernel = kernel;

    kernel.onNotification((notif: KernelNotification) => {
      const notification = {
        sessionId: notif.sessionId,
        update: notif.update,
      };

      try { agent._handleKernelNotification(notif); } catch (err) {
        log.warn(`[${name}] kernel _handleNotification error: ${(err as Error).message}`);
      }
      try { onNotification(notif.sessionId, notification); } catch (err) {
        log.warn(`[${name}] kernel onNotification error: ${(err as Error).message}`);
      }
    });

    agent._transition(AgentState.Idle);

    log.info(`Agent [${name}] ready (kernel mode), sessionId=${sessionId}`);
    return agent;
  }

  async send(blocks: PromptBlock[]): Promise<void> {
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

  async cancel(): Promise<'cancelled'> {
    if (this._kernel) {
      this._kernel.cancel();
      this._logger.info(`Agent [${this.name}] kernel cancelled`);
    }
    return 'cancelled';
  }

  stop(): void {
    this._transition(AgentState.Stopped);

    if (this._kernel) {
      this._kernel.stop();
      this._logger.info(`Agent [${this.name}] kernel stopped`);
    }

    const drained = this._queue.splice(0);
    for (const item of drained) {
      item.reject(new Error(`Agent [${this.name}] stopped`));
    }
  }

  async clearContext(): Promise<string> {
    this._transition(AgentState.Starting);

    if (this._kernel) {
      try {
        this._kernel.clearContext();
        this._sessionId = this._kernel.sessionId;
        this._logger.info(`Agent [${this.name}] kernel context cleared: ${this._sessionId}`);
        this._transition(AgentState.Idle);
        return this._sessionId;
      } catch (err) {
        this._transition(AgentState.Error);
        throw err;
      }
    }

    this._transition(AgentState.Idle);
    return this._sessionId;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    this._logger.info(`Agent [${this.name}] kernel mode: config ${configId}=${value} (ignored)`);
  }

  // -----------------------------------------------------------------------
  // 内部：状态机
  // -----------------------------------------------------------------------

  private _transition(newState: AgentState): void {
    const oldState = this._state;
    if (oldState === newState) return;
    this._state = newState;
    this._logger.info(`Agent [${this.name}] state: ${oldState} → ${newState}`);
    this._onStateChange?.(newState, oldState);

    if (newState === AgentState.Idle && this._queue.length > 0) {
      this._drainQueue();
    }
  }

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

  // -----------------------------------------------------------------------
  // 内部：消息处理 + 队列消费
  // -----------------------------------------------------------------------

  private async _processMessage(blocks: PromptBlock[]): Promise<void> {
    this._transition(AgentState.Streaming);

    if (this._kernel) {
      try {
        await this._kernel.send(blocks);
        this._transition(AgentState.Idle);
      } catch (err) {
        this._transition(AgentState.Error);
        throw err;
      }
      return;
    }

    throw new Error(`Agent [${this.name}] has no kernel`);
  }

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
