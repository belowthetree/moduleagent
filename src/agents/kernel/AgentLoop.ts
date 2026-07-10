// ---------------------------------------------------------------------------
// agents/kernel/AgentLoop.ts — 核心推理循环（基于 ai-sdk generateText）
// 使用 ai-sdk 的 stopWhen 自动处理工具调用循环
// ---------------------------------------------------------------------------

import { generateText, stepCountIs } from 'ai';
import { resolveLanguageModel } from './ProviderResolver.js';
import { convertToolsToAISDK } from './ToolConverter.js';
import type {
  AgentLoopConfig,
  LoopPhase,
  PromptBlock,
} from './types.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

export interface LoopEvents {
  onPhaseChange: (phase: LoopPhase, data?: unknown) => void;
  onStreamChunk: (text: string) => void;
  onToolCall: (toolName: string, toolCallId: string, status: string, detail?: string) => void;
  onError: (error: Error) => void;
}

const DEFAULT_MAX_TOOL_ROUNDS = 15;

export class AgentLoop {
  private systemPrompt: string;
  private maxToolRounds: number;
  private messages: any[] = [];
  private logger: Logger;
  private events: LoopEvents;
  private _phase: LoopPhase = 'idle' as LoopPhase;
  private _cancelled = false;
  private _sessionId: string;
  private tools: Record<string, any>;
  private model: ReturnType<typeof resolveLanguageModel>['model'];
  private abortController: AbortController | null = null;

  constructor(config: AgentLoopConfig, events: LoopEvents, logger?: Logger) {
    const resolved = resolveLanguageModel(config.kernelConfig);
    this.model = resolved.model;
    this.systemPrompt = config.systemPrompt;
    this.maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.logger = logger || defaultLogger;
    this.events = events;
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.tools = convertToolsToAISDK(config.tools);
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get phase(): LoopPhase {
    return this._phase;
  }

  get conversationHistory(): any[] {
    return [...this.messages];
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
    this.messages = [];
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async send(blocks: PromptBlock[]): Promise<{ stopReason: string; content: string }> {
    this._cancelled = false;
    this.abortController = new AbortController();
    this.setPhase('thinking' as LoopPhase);

    const userText = blocks.map((b) => b.text).join('\n');
    this.messages.push({ role: 'user', content: userText });

    try {
      const result = await generateText({
        model: this.model,
        system: this.systemPrompt,
        messages: this.messages,
        tools: Object.keys(this.tools).length > 0 ? this.tools : undefined,
        stopWhen: stepCountIs(this.maxToolRounds + 1),
        abortSignal: this.abortController!.signal,
        maxRetries: 1,
        onStepFinish: (event) => {
          if (event.toolCalls) {
            for (const tc of event.toolCalls) {
              const tcid = (tc as any).toolCallId || '';
              this.logger.info(`[AgentLoop] tool_call: ${tc.toolName} id=${tcid}`);
              this.events.onToolCall(tc.toolName, tcid, 'running', JSON.stringify((tc as any).input || {}).slice(0, 500));
              this.setPhase('tool_call' as LoopPhase, { toolName: tc.toolName, toolCallId: tcid, args: (tc as any).input });
            }
          }
          if (event.toolResults) {
            for (const tr of event.toolResults) {
              const tcid = (tr as any).toolCallId || '';
              this.logger.info(`[AgentLoop] tool_result: ${tr.toolName} id=${tcid}`);
              this.events.onToolCall(
                tr.toolName,
                tcid,
                (tr as any).error ? 'error' : 'completed',
                JSON.stringify((tr as any).output || '').slice(0, 500),
              );
            }
          }
        },
      });

      if (this._cancelled) {
        this.setPhase('cancelled' as LoopPhase);
        return { stopReason: 'cancelled', content: '' };
      }

      const text = result.text || '';

      this.messages = [...result.response.messages];

      if (text) {
        this.events.onStreamChunk(text);
      }

      this.setPhase('done' as LoopPhase);
      return {
        stopReason: 'end_turn',
        content: text || 'Task completed.',
      };
    } catch (err) {
      if (this._cancelled) {
        this.setPhase('cancelled' as LoopPhase);
        return { stopReason: 'cancelled', content: '' };
      }
      this.setPhase('error' as LoopPhase);
      this.events.onError(err as Error);
      this.logger.error(`[AgentLoop] error: ${(err as Error).message}`);
      throw err;
    }
  }
}
