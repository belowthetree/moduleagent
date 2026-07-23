// ---------------------------------------------------------------------------
// agents/kernel/AgentKernel.ts — 统一代理内核入口
// 提供与 Agent.ts 兼容的接口
// 内部使用 LLMClient + ToolRegistry + AgentLoop
// ---------------------------------------------------------------------------

import { ToolRegistry } from './ToolRegistry.js';
import { AgentLoop, type LoopEvents } from './AgentLoop.js';
import { createKernelToolRegistry, createRootKernelToolRegistry } from './tools/index.js';
import { createModuleContextTools } from './tools/module-context.js';
import { AgentSandbox } from './Sandbox.js';
import type { KernelConfig, AgentLoopConfig, PromptBlock } from './types.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';
import type { CrossModuleRouter } from '../mcp/McpBackend.js';

export interface KernelOptions {
  name: string;
  config: KernelConfig;
  workspaceRoot: string;
  systemPrompt: string;
  sandbox?: AgentSandbox;
  crossModuleRouter?: CrossModuleRouter;
  requestingModule?: string;
  maxToolRounds?: number;
  logger?: Logger;
  isRoot?: boolean;
  /** 模块文档目录（.module-agent/module/<name>/），用于注册 module_context:* 按需工具 */
  moduleDir?: string;
  /** 上下文截断配置（透传 AgentLoop） */
  truncation?: AgentLoopConfig['truncation'];
  /** 在线压缩配置（透传 AgentLoop） */
  compaction?: AgentLoopConfig['compaction'];
  /** 被丢弃内容的存档目录（透传 AgentLoop） */
  archiveDir?: string;
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
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class AgentKernel {
  readonly name: string;
  readonly workspaceRoot: string;

  private registry: ToolRegistry;
  private loop: AgentLoop;
  private logger: Logger;
  private _sessionId: string;
  private _onNotification: NotificationCallback | null = null;
  private _mcpProcess: any = null;

  constructor(options: KernelOptions) {
    this.name = options.name;
    this.workspaceRoot = options.sandbox?.rootPath || options.workspaceRoot;
    this.logger = options.logger || defaultLogger;
    this._sessionId = `kernel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 注册内置工具 + 可选 MCP 桥接
    const sandbox = options.sandbox || new AgentSandbox({ allowed: [options.workspaceRoot], excluded: [] });
    this.registry = options.isRoot
      ? createRootKernelToolRegistry(sandbox, options.crossModuleRouter, options.requestingModule)
      : createKernelToolRegistry(sandbox, options.crossModuleRouter, options.requestingModule);

    // P1: 渐进式上下文披露 — 注册 module_context:* 按需工具
    if (options.moduleDir && !options.isRoot) {
      const ctxTools = createModuleContextTools(options.moduleDir);
      this.registry.registerAll(ctxTools);
      this.logger.info(`[Kernel:${this.name}] registered ${ctxTools.length} module_context tools`);
    }

    const toolNames = this.registry.list().map(t => t.name);
    const router = options.crossModuleRouter ? '有' : '无';
    this.logger.info(`[Kernel:${this.name}] isRoot=${!!options.isRoot} router=${router} tools (${toolNames.length}): ${toolNames.join(', ')}`);

    const loopEvents: LoopEvents = {
      onPhaseChange: (phase) => {
        this.logger.info(`[Kernel:${this.name}] 阶段: ${phase}`);
      },
      onStreamChunk: (text) => {
        this._emit('agent_message_chunk', {
          content: { type: 'text', text },
        });
      },
      onReasoningChunk: (text) => {
        this._emit('agent_thought_chunk', {
          content: { text },
        });
      },
      onToolCall: (toolName, toolCallId, status, detail) => {
        if (status === 'completed' || status === 'error') {
          this._emit('tool_call_update', {
            title: toolName,
            toolCallId,
            status,
            detail: { output: detail },
          });
        } else {
          this._emit('tool_call', {
            title: toolName,
            toolCallId,
            status,
            detail: { input: detail },
          });
        }
      },
      onError: (error) => {
        this.logger.error(`[Kernel:${this.name}] 错误: ${error.message}`);
      },
      onContextUsage: (usage) => {
        this._emit('context_usage', { detail: usage });
      },
    };

    const loopConfig: AgentLoopConfig = {
      kernelConfig: options.config,
      systemPrompt: options.systemPrompt,
      workspaceRoot: options.workspaceRoot,
      tools: this.registry.list(),
      maxToolRounds: options.maxToolRounds,
      truncation: options.truncation,
      compaction: options.compaction,
      archiveDir: options.archiveDir,
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
    return '';
  }

  onNotification(callback: NotificationCallback): void {
    this._onNotification = callback;
  }

  async send(blocks: PromptBlock[]): Promise<KernelSendResult> {
    this.logger.info(`[Kernel:${this.name}] 发送: ${blocks.length} 个块`);
    const result = await this.loop.send(blocks);
    this.logger.info(`[Kernel:${this.name}] 结果: stopReason=${result.stopReason}`);
    if (result.usage) {
      this.logger.info(
        `[Kernel:${this.name}] usage: prompt=${result.usage.promptTokens} ` +
        `completion=${result.usage.completionTokens} total=${result.usage.totalTokens}`,
      );
    }
    return result;
  }

  cancel(): void {
    this.loop.cancel();
  }

  stop(): void {
    this.loop.cancel();
  }

  clearContext(): void {
    this.loop.resetHistory();
    this._sessionId = `kernel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getHistory(): any[] {
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
