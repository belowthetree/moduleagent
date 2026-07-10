// ---------------------------------------------------------------------------
// agents/kernel/AgentLoop.ts — 核心推理循环
// 手动管理工具调用循环，使用 ai-sdk 作为 LLM 提供商抽象
// ---------------------------------------------------------------------------

import { generateText, type ModelMessage } from 'ai';
import { resolveLanguageModel } from './ProviderResolver.js';
import { convertToolDefinitionToAISDK } from './ToolConverter.js';
import { ToolRegistry } from './ToolRegistry.js';
import type {
  ToolDefinition,
  AgentLoopConfig,
  LoopPhase,
  PromptBlock,
} from './types.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

export interface LoopEvents {
  onPhaseChange: (phase: LoopPhase, data?: unknown) => void;
  onStreamChunk: (text: string) => void;
  onToolCall: (toolName: string, status: string, detail?: string) => void;
  onError: (error: Error) => void;
}

const DEFAULT_MAX_TOOL_ROUNDS = 15;

export class AgentLoop {
  private systemPrompt: string;
  private workspaceRoot: string;
  private maxToolRounds: number;
  private history: ModelMessage[] = [];
  private logger: Logger;
  private events: LoopEvents;
  private _phase: LoopPhase = 'idle' as LoopPhase;
  private _cancelled = false;
  private _sessionId: string;
  private model: ReturnType<typeof resolveLanguageModel>['model'];
  private abortController: AbortController | null = null;

  constructor(config: AgentLoopConfig, events: LoopEvents, logger?: Logger) {
    const resolved = resolveLanguageModel(config.kernelConfig);
    this.model = resolved.model;
    this.systemPrompt = config.systemPrompt;
    this.workspaceRoot = config.workspaceRoot;
    this.maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.logger = logger || defaultLogger;
    this.events = events;
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const registry = new ToolRegistry();
    registry.registerAll(config.tools);
    this._tools = registry.list();
  }

  private _tools: import('./types.js').Tool[] = [];

  get sessionId(): string {
    return this._sessionId;
  }

  get phase(): LoopPhase {
    return this._phase;
  }

  get conversationHistory(): ModelMessage[] {
    return [...this.history];
  }

  private setPhase(phase: LoopPhase, data?: unknown): void {
    this._phase = phase;
    this.events.onPhaseChange(phase, data);
  }

  cancel(): void {
    this._cancelled = true;
    this.abortController?.abort();
    this.setPhase('cancelled' as LoopPhase);
  }

  resetHistory(): void {
    this.history = [];
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async send(blocks: PromptBlock[]): Promise<{ stopReason: string; content: string }> {
    this._cancelled = false;
    this.abortController = new AbortController();
    this.setPhase('thinking' as LoopPhase);

    const userText = blocks.map((b) => b.text).join('\n');
    this.history.push({ role: 'user', content: userText });

    try {
      const result = await this._runLoop();
      this.setPhase('done' as LoopPhase);
      return result;
    } catch (err) {
      if (this._cancelled) {
        this.setPhase('cancelled' as LoopPhase);
        return { stopReason: 'cancelled', content: '' };
      }
      this.setPhase('error' as LoopPhase);
      this.events.onError(err as Error);
      throw err;
    }
  }

  private async _runLoop(): Promise<{ stopReason: string; content: string }> {
    let toolRounds = 0;

    while (toolRounds < this.maxToolRounds) {
      if (this._cancelled) {
        return { stopReason: 'cancelled', content: '' };
      }

      const messages: ModelMessage[] = [
        ...this.history,
      ];

      const toolDefs = this._tools.map((t) => convertToolDefinitionToAISDK(t));

      const response = await generateText({
        model: this.model,
        system: this.systemPrompt,
        messages,
        tools: toolDefs.length > 0 ? toolDefs as any : undefined,
        abortSignal: this.abortController!.signal,
        maxRetries: 1,
      });

      if (this._cancelled) {
        return { stopReason: 'cancelled', content: '' };
      }

      const text = response.text || '';
      if (text) {
        this.events.onStreamChunk(text);
      }

      const toolCalls = response.toolCalls || [];
      const hasToolCalls = toolCalls.length > 0;

      if (hasToolCalls) {
        toolRounds++;

        const assistantContent: any[] = [];
        if (text) {
          assistantContent.push({ type: 'text', text });
        }
        for (const tc of toolCalls) {
          assistantContent.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: (tc as any).input || {},
          });
        }
        this.history.push({
          role: 'assistant',
          content: assistantContent as any,
        });

        for (const tc of toolCalls) {
          if (this._cancelled) break;

          const toolName = tc.toolName;
          const input = (tc as any).input as Record<string, unknown>;

          this.logger.info(`[AgentLoop] tool_call: ${toolName} ${JSON.stringify(input).slice(0, 200)}`);
          this.events.onToolCall(toolName, 'running', JSON.stringify(input).slice(0, 500));
          this.setPhase('tool_call' as LoopPhase, { toolName, args: input });

          const registry = new ToolRegistry();
          registry.registerAll(this._tools);
          const result = await registry.execute(toolName, input);

          this.logger.info(`[AgentLoop] tool_result: ${toolName} success=${!result.metadata?.error}`);
          this.events.onToolCall(
            toolName,
            result.metadata?.error ? 'error' : 'completed',
            result.content.slice(0, 500),
          );

          this.history.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                result: result.content,
              },
            ] as any,
          });
        }

        this.setPhase('thinking' as LoopPhase);
        continue;
      }

      this.history.push({
        role: 'assistant',
        content: text || '',
      });

      return {
        stopReason: 'end_turn',
        content: text || '',
      };
    }

    return {
      stopReason: 'max_turns',
      content: '已达到最大工具调用轮数。',
    };
  }
}
