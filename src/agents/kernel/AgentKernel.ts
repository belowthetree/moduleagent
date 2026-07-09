// ---------------------------------------------------------------------------
// agents/kernel/AgentKernel.ts — 统一代理内核入口
// 替代 ACP 连接，提供与 Agent.ts 兼容的接口
// 内部使用 LLMClient + ToolRegistry + AgentLoop
// ---------------------------------------------------------------------------

import { LLMClient } from './LLMClient.js';
import { ToolRegistry } from './ToolRegistry.js';
import { AgentLoop, type LoopEvents } from './AgentLoop.js';
import { createKernelToolRegistry, type McpBridgeOptions } from './tools/index.js';
import type { KernelConfig, AgentLoopConfig, PromptBlock, ChatMessage } from './types.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

export interface KernelOptions {
  name: string;
  config: KernelConfig;
  workspaceRoot: string;
  systemPrompt: string;
  mcpBridge?: McpBridgeOptions;
  maxToolRounds?: number;
  logger?: Logger;
}

export interface KernelNotification {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: { type?: string; text?: string };
    title?: string;
    status?: string;
    detail?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export type NotificationCallback = (notification: KernelNotification) => void;

export interface KernelSendResult {
  stopReason: string;
  content: string;
}

export class AgentKernel {
  readonly name: string;
  readonly workspaceRoot: string;

  private client: LLMClient;
  private registry: ToolRegistry;
  private loop: AgentLoop;
  private logger: Logger;
  private _sessionId: string;
  private _onNotification: NotificationCallback | null = null;
  private _mcpProcess: any = null;

  constructor(options: KernelOptions) {
    this.name = options.name;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger || defaultLogger;
    this._sessionId = `kernel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.client = new LLMClient(options.config);

    this.registry = createKernelToolRegistry(options.workspaceRoot, options.mcpBridge);

    const loopEvents: LoopEvents = {
      onPhaseChange: (phase, data) => {
        this.logger.info(`[Kernel:${this.name}] phase: ${phase}`);
        if (phase === 'tool_call' && data) {
          const d = data as { toolName?: string; args?: unknown };
          this._emit('tool_call', {
            title: d.toolName || 'unknown',
            status: 'running',
            detail: { arguments: d.args },
          });
        }
      },
      onStreamChunk: (text) => {
        this._emit('agent_message_chunk', {
          content: { type: 'text', text },
        });
      },
      onToolCall: (toolName, status, detail) => {
        if (status === 'completed' || status === 'error') {
          this._emit('tool_call_update', {
            title: toolName,
            status,
            detail: { output: detail },
          });
        } else {
          this._emit('tool_call', {
            title: toolName,
            status,
            detail: { input: detail },
          });
        }
      },
      onError: (error) => {
        this.logger.error(`[Kernel:${this.name}] error: ${error.message}`);
      },
    };

    const loopConfig: AgentLoopConfig = {
      kernelConfig: options.config,
      systemPrompt: options.systemPrompt,
      workspaceRoot: options.workspaceRoot,
      tools: this.registry.list(),
      maxToolRounds: options.maxToolRounds,
    };

    this.loop = new AgentLoop(loopConfig, loopEvents, this.logger);
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get toolRegistry(): ToolRegistry {
    return this.registry;
  }

  getModel(): string {
    return this.client.getModel();
  }

  onNotification(callback: NotificationCallback): void {
    this._onNotification = callback;
  }

  async send(blocks: PromptBlock[]): Promise<KernelSendResult> {
    this.logger.info(`[Kernel:${this.name}] send: ${blocks.length} blocks`);
    const result = await this.loop.send(blocks);
    this.logger.info(`[Kernel:${this.name}] result: stopReason=${result.stopReason}, content=${result.content.slice(0, 100)}`);
    return result;
  }

  cancel(): void {
    this.loop.cancel();
  }

  stop(): void {
    this.loop.cancel();
  }

  clearContext(keepSystem: boolean = true): void {
    this.loop.resetHistory(keepSystem);
    this._sessionId = `kernel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getHistory(): ChatMessage[] {
    return this.loop.conversationHistory;
  }

  private _emit(sessionUpdate: string, extra: Record<string, unknown> = {}): void {
    if (!this._onNotification) return;

    this._onNotification({
      sessionId: this._sessionId,
      update: {
        sessionUpdate,
        ...extra,
      },
    });
  }
}
