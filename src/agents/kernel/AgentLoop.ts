// ---------------------------------------------------------------------------
// agents/kernel/AgentLoop.ts — 核心推理循环
// 实现 prompt → LLM → tool_calls → LLM → response 循环
// 参考 claude-code-rust 的 Repl::process_input()
// ---------------------------------------------------------------------------

import { LLMClient } from './LLMClient.js';
import { ToolRegistry } from './ToolRegistry.js';
import type {
  ChatMessage,
  ChatResponse,
  ToolCall,
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
  private client: LLMClient;
  private registry: ToolRegistry;
  private systemPrompt: string;
  private workspaceRoot: string;
  private maxToolRounds: number;
  private history: ChatMessage[] = [];
  private logger: Logger;
  private events: LoopEvents;
  private _phase: LoopPhase = 'idle' as LoopPhase;
  private _cancelled = false;
  private _sessionId: string;

  constructor(config: AgentLoopConfig, events: LoopEvents, logger?: Logger) {
    this.client = new LLMClient(config.kernelConfig);
    this.registry = new ToolRegistry();
    this.registry.registerAll(config.tools);
    this.systemPrompt = config.systemPrompt;
    this.workspaceRoot = config.workspaceRoot;
    this.maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.logger = logger || defaultLogger;
    this.events = events;
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (this.systemPrompt) {
      this.history.push({ role: 'system', content: this.systemPrompt });
    }
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get phase(): LoopPhase {
    return this._phase;
  }

  get conversationHistory(): ChatMessage[] {
    return [...this.history];
  }

  private setPhase(phase: LoopPhase, data?: unknown): void {
    this._phase = phase;
    this.events.onPhaseChange(phase, data);
  }

  cancel(): void {
    this._cancelled = true;
    this.setPhase('cancelled' as LoopPhase);
  }

  resetHistory(keepSystem: boolean = true): void {
    if (keepSystem) {
      this.history = this.history.filter((m) => m.role === 'system');
    } else {
      this.history = [];
      if (this.systemPrompt) {
        this.history.push({ role: 'system', content: this.systemPrompt });
      }
    }
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async send(blocks: PromptBlock[]): Promise<{ stopReason: string; content: string }> {
    this._cancelled = false;
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
    const tools = this.registry.listDefinitions();
    let toolRounds = 0;

    while (toolRounds < this.maxToolRounds) {
      if (this._cancelled) {
        return { stopReason: 'cancelled', content: '' };
      }

      const response = await this._callLLM(tools);

      if (this._cancelled) {
        return { stopReason: 'cancelled', content: '' };
      }

      const choice = response.choices?.[0];
      if (!choice) {
        return { stopReason: 'end_turn', content: '' };
      }

      const message = choice.message;

      const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;

      if (hasToolCalls) {
        toolRounds++;

        this.history.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        });

        for (const tc of message.tool_calls!) {
          if (this._cancelled) break;

          const toolName = tc.function.name;
          let args: Record<string, unknown>;

          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

          this.logger.info(`[AgentLoop] tool_call: ${toolName} ${JSON.stringify(args).slice(0, 200)}`);
          this.events.onToolCall(toolName, 'running', JSON.stringify(args).slice(0, 500));
          this.setPhase('tool_call' as LoopPhase, { toolName, args });

          const result = await this.registry.execute(toolName, args);

          this.logger.info(`[AgentLoop] tool_result: ${toolName} success=${!result.metadata?.error}`);
          this.events.onToolCall(
            toolName,
            result.metadata?.error ? 'error' : 'completed',
            result.content.slice(0, 500),
          );

          this.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.content,
          });
        }

        this.setPhase('thinking' as LoopPhase);
        continue;
      }

      const textContent = message.content || '';
      this.history.push({
        role: 'assistant',
        content: textContent,
      });

      return {
        stopReason: 'end_turn',
        content: textContent,
      };
    }

    return {
      stopReason: 'max_turns',
      content: 'Reached maximum tool call rounds.',
    };
  }

  private async _callLLM(tools: ToolDefinition[]): Promise<ChatResponse> {
    const response = await this.client.chat(this.history, tools.length > 0 ? tools : undefined);

    const textContent = response.choices?.[0]?.message?.content || '';
    if (textContent) {
      this.events.onStreamChunk(textContent);
    }

    return response;
  }
}
