// ---------------------------------------------------------------------------
// agents/kernel/AgentLoop.ts — 核心推理循环（基于 ai-sdk generateText）
// 使用 ai-sdk 的 stopWhen 自动处理工具调用循环
//
// 优化模块（集成自 P0/P1/P2/P3）：
//   P0 — TokenEstimator（token 校准）+ HistoryTruncator（滑动窗口截断）
//   P2 — ModelRouter（快/慢模型路由）+ ContextCompactor（在线压缩）
//   P3 — StormBreaker（死循环检测）
//
// 消息历史全程保持 ai-sdk ModelMessage[] 结构：
// response.messages 只含本次调用新生成的消息，必须追加而非替换。
// ---------------------------------------------------------------------------

import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { resolveLanguageModel } from './ProviderResolver.js';
import { convertToolsToAISDK } from './ToolAdapter.js';
import { TokenEstimator } from '../../core/TokenEstimator.js';
import { HistoryTruncator, DEFAULT_TRUNCATION_CONFIG, slimMessages } from './HistoryTruncator.js';
import { ModelRouter } from './ModelRouter.js';
import { ContextCompactor, DEFAULT_COMPACTION_CONFIG } from './ContextCompactor.js';
import { StormBreaker } from './StormBreaker.js';
import { ToolResultSnipper, DEFAULT_SNIP_CONFIG } from './ToolResultSnipper.js';
import { createArchiveWriter } from './ArchiveWriter.js';
import { withRetry, isRetryableError } from '../../core/RetryPolicy.js';
import type {
  AgentLoopConfig,
  LoopPhase,
  PromptBlock,
} from './types.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

// ── 事件接口 ──

export interface LoopEvents {
  onPhaseChange: (phase: LoopPhase, data?: unknown) => void;
  onStreamChunk: (text: string) => void;
  onReasoningChunk: (text: string) => void;
  onToolCall: (toolName: string, toolCallId: string, status: string, detail?: string) => void;
  onError: (error: Error) => void;
  /** 上下文用量越过 50% 时触发（滞回：降至 40% 以下后重置） */
  onContextUsage?: (usage: { tokens: number; window: number; ratio: number }) => void;
}

// ── 发送结果 ──

export interface SendResult {
  stopReason: string;
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ── 常量 ──

const DEFAULT_MAX_TOOL_ROUNDS = 15;

// ── AgentLoop ──

export class AgentLoop {
  // ── 核心状态 ──
  private systemPrompt: string;
  private maxToolRounds: number;
  private messages: ModelMessage[] = [];
  private logger: Logger;
  private events: LoopEvents;
  private _phase: LoopPhase = 'idle' as LoopPhase;
  private _cancelled = false;
  private _sessionId: string;
  private tools: Record<string, any>;
  private model: ReturnType<typeof resolveLanguageModel>['model'];
  private fastModel: ReturnType<typeof resolveLanguageModel>['model'] | null = null;
  private abortController: AbortController | null = null;

  // ── P0 优化模块 ──
  private tokenEstimator: TokenEstimator;
  private historyTruncator: HistoryTruncator;
  private toolResultSnipper: ToolResultSnipper;

  // ── P2 优化模块 ──
  private modelRouter: ModelRouter;
  private contextCompactor: ContextCompactor | null = null;

  // ── P3 优化模块 ──
  private stormBreaker: StormBreaker;

  // ── 配置 ──
  private contextWindow: number;
  private contextUsageNotified = false;
  /** LLM 采样参数（仅当配置存在时传递，避免 undefined 覆盖 SDK 默认值） */
  private maxOutputTokens?: number;
  private temperature?: number;

  constructor(config: AgentLoopConfig, events: LoopEvents, logger?: Logger) {
    // 基础赋值（logger 必须先赋值，后续代码可能引用）
    this.logger = logger || defaultLogger;

    // 模型
    const resolved = resolveLanguageModel(config.kernelConfig);
    this.model = resolved.model;

    // fastModel（可选）
    if (config.kernelConfig.fastModel) {
      try {
        const fastResolved = resolveLanguageModel({
          ...config.kernelConfig,
          model: config.kernelConfig.fastModel,
        });
        this.fastModel = fastResolved.model;
      } catch {
        this.logger.warn('fastModel 解析失败，将始终使用主模型');
      }
    }

    this.systemPrompt = config.systemPrompt;
    this.maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.events = events;
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.maxOutputTokens = config.kernelConfig.maxTokens;
    this.temperature = config.kernelConfig.temperature;

    // 工具：按名称排序以保证 schema 字节级稳定（P1 缓存友好）
    const sortedTools = [...config.tools].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    this.tools = convertToolsToAISDK(sortedTools);

    // ── P0: TokenEstimator + HistoryTruncator + ToolResultSnipper ──
    this.tokenEstimator = new TokenEstimator();
    this.contextWindow =
      config.truncation?.contextWindow ??
      config.kernelConfig.contextWindow ??
      DEFAULT_TRUNCATION_CONFIG.contextWindow;

    const archiveWriter = createArchiveWriter(config.archiveDir);

    this.historyTruncator = new HistoryTruncator(
      {
        contextWindow: this.contextWindow,
        truncateRatio:
          config.truncation?.truncateRatio ??
          DEFAULT_TRUNCATION_CONFIG.truncateRatio,
        tailTokenBudget:
          config.truncation?.tailTokenBudget ??
          DEFAULT_TRUNCATION_CONFIG.tailTokenBudget,
        minKeepMessages:
          config.truncation?.minKeepMessages ??
          DEFAULT_TRUNCATION_CONFIG.minKeepMessages,
      },
      this.tokenEstimator,
      undefined,
      undefined,
      archiveWriter
        ? (records) => archiveWriter('history-truncated.jsonl', records)
        : undefined,
    );

    this.toolResultSnipper = new ToolResultSnipper(
      { snipRatio: config.truncation?.snipRatio ?? DEFAULT_SNIP_CONFIG.snipRatio },
      this.tokenEstimator,
      archiveWriter,
      this.logger,
    );

    // ── P2: ModelRouter ──
    this.modelRouter = new ModelRouter();

    // ── P2: ContextCompactor（仅当配置启用时创建） ──
    if (config.compaction?.enabled && this.fastModel) {
      this.contextCompactor = new ContextCompactor(
        {
          compactRatio:
            config.compaction.compactRatio ??
            DEFAULT_COMPACTION_CONFIG.compactRatio,
          tailTokenBudget:
            config.compaction.tailTokenBudget ??
            DEFAULT_COMPACTION_CONFIG.tailTokenBudget,
          minIntervalMs:
            config.compaction.minIntervalMs ??
            DEFAULT_COMPACTION_CONFIG.minIntervalMs,
        },
        this.tokenEstimator,
        this.fastModel, // 使用 fastModel 做总结
        this.logger,
        archiveWriter
          ? (records) => archiveWriter('compacted.jsonl', records)
          : undefined,
      );
    }

    // ── P3: StormBreaker ──
    this.stormBreaker = new StormBreaker();

    this.logger.info(
      `[AgentLoop] init: model=${resolved.modelName} fastModel=${config.kernelConfig.fastModel ?? '-'} contextWindow=${this.contextWindow} compaction=${this.contextCompactor ? 'on' : 'off'}`,
    );
  }

  // ── 属性 ──

  get sessionId(): string {
    return this._sessionId;
  }

  get phase(): LoopPhase {
    return this._phase;
  }

  get conversationHistory(): ModelMessage[] {
    return [...this.messages];
  }

  /** 公开 tokenEstimator 以便外部查询用量 */
  get estimator(): TokenEstimator {
    return this.tokenEstimator;
  }

  // ── 阶段管理 ──

  private setPhase(phase: LoopPhase, data?: unknown): void {
    this._phase = phase;
    this.events.onPhaseChange(phase, data);
  }

  // ── 生命周期 ──

  cancel(): void {
    this._cancelled = true;
    this.abortController?.abort();
    this.setPhase('cancelled' as LoopPhase);
  }

  resetHistory(): void {
    this.messages = [];
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.stormBreaker.reset();
  }

  // ── 发送（主入口） ──

  async send(blocks: PromptBlock[]): Promise<SendResult> {
    this._cancelled = false;
    this.abortController = new AbortController();
    this.setPhase('thinking' as LoopPhase);

    const userText = blocks.map((b) => b.text).join('\n');
    this.messages.push({ role: 'user', content: userText });

    try {
      // ── Step 0: 旧工具结果 snip（零 LLM 成本，60% 阈值） ──
      this.toolResultSnipper.snipStale(this.messages, this.contextWindow);

      // ── Step 1: 尝试在线压缩（P2，仅在启用时） ──
      let compactionLog = '';
      if (this.contextCompactor) {
        const compactResult = await this.contextCompactor.maybeCompact(
          this.messages,
          this.contextWindow,
        );
        if (compactResult.compacted) {
          // 用压缩结果替换（保留 head + summary + tail）
          this.messages = compactResult.messages;
          compactionLog = `compacted=${compactResult.foldedCount}msgs tokens=${compactResult.beforeTokens}→${compactResult.afterTokens}`;
        }
      }

      // ── Step 2: 滑动窗口截断（P0） ──
      const beforeTokens = this.tokenEstimator.estimateMessages(
        slimMessages(this.messages),
      );
      const softThreshold = this.contextWindow * 0.5;

      // 软警告：超过 50% 窗口（滞回：降至 40% 以下后重置）
      const usageRatio = beforeTokens / this.contextWindow;
      if (beforeTokens > softThreshold) {
        this.logger.info(
          `[AgentLoop] context: ${beforeTokens}/${this.contextWindow} tokens (${(usageRatio * 100).toFixed(0)}%), ` +
          `${this.messages.length} msgs`,
        );
        if (!this.contextUsageNotified) {
          this.contextUsageNotified = true;
          this.events.onContextUsage?.({
            tokens: beforeTokens,
            window: this.contextWindow,
            ratio: usageRatio,
          });
        }
      } else if (usageRatio < 0.4) {
        this.contextUsageNotified = false;
      }

      const truncResult = this.historyTruncator.truncate(this.messages);

      if (truncResult.truncatedCount > 0) {
        // 重建 messages: [head, ...truncated]
        const head = this.messages[0]!;
        this.messages = [head, ...truncResult.messages];
        this.logger.warn(
          `[AgentLoop] truncated ${truncResult.truncatedCount} msgs, tokens: ${truncResult.beforeTokens}→${truncResult.afterTokens}${compactionLog ? ' + ' + compactionLog : ''}`,
        );
      } else if (compactionLog) {
        this.logger.info(`[AgentLoop] ${compactionLog}`);
      }

      // ── Step 3: 路由模型（P2） ──
      const activeModel = this.selectModel(userText);

      // ── Step 4: LLM 调用（带重试） ──
      // 外层重试仅当首个 step 完成前失败才触发——一旦某 step 完成，
      // 整体重试会重复执行已完成的副作用工具（file_write 等）。
      let stepsCompleted = 0;
      // StormBreaker 干预消息缓冲：generateText 执行期间 push 进 this.messages
      // 不会被本次调用感知，且会被结果合并覆盖。先缓冲，待 response.messages
      // 合并完成后按序追加，确保下一轮调用能看到干预。
      const interventions: ModelMessage[] = [];
      const result = await withRetry(
        () => generateText({
          model: activeModel,
          system: this.systemPrompt,
          messages: this.messages,
          tools: Object.keys(this.tools).length > 0 ? this.tools : undefined,
          stopWhen: stepCountIs(this.maxToolRounds + 1),
          abortSignal: this.abortController!.signal,
          maxRetries: 2,
          // 仅当配置存在时传递，避免 undefined 覆盖 SDK 默认值
          ...(this.maxOutputTokens != null
            ? { maxOutputTokens: this.maxOutputTokens }
            : {}),
          ...(this.temperature != null ? { temperature: this.temperature } : {}),
          onStepFinish: (event) => {
            stepsCompleted++;
          // 推理内容
          const reasoning = (event as any).reasoningText as string | undefined;
          if (reasoning) {
            this.logger.info(`[AgentLoop] reasoning: ${reasoning.length} chars`);
            this.events.onReasoningChunk(reasoning);
          }

          // 工具调用
          if (event.toolCalls) {
            for (const tc of event.toolCalls) {
              const tcid = (tc as any).toolCallId || '';
              this.logger.info(`[AgentLoop] tool_call: ${tc.toolName} id=${tcid}`);
              this.events.onToolCall(
                tc.toolName,
                tcid,
                'running',
                JSON.stringify((tc as any).input || {}).slice(0, 500),
              );
              this.setPhase('tool_call' as LoopPhase, {
                toolName: tc.toolName,
                toolCallId: tcid,
                args: (tc as any).input,
              });
            }
          }

          // 工具结果 — 死循环检测（P3）
          if (event.toolResults) {
            for (const tr of event.toolResults) {
              const tcid = (tr as any).toolCallId || '';
              const isError = !!(tr as any).error;
              this.logger.info(
                `[AgentLoop] tool_result: ${tr.toolName} id=${tcid}` +
                  (isError ? ` error="${(tr as any).error}"` : ''),
              );
              this.events.onToolCall(
                tr.toolName,
                tcid,
                isError ? 'error' : 'completed',
                JSON.stringify((tr as any).output || '').slice(0, 500),
              );

              // StormBreaker 检测（干预消息先缓冲，见上方 interventions 注释）
              if (isError) {
                const { intervene, message } = this.stormBreaker.detect(
                  tr.toolName,
                  (tr as any).error || '',
                );
                if (intervene && message) {
                  interventions.push({ role: 'user', content: message });
                  this.logger.warn(
                    `[StormBreaker] intervened after ${this.stormBreaker.maxStorms} repeated failures on "${tr.toolName}"`,
                  );
                }
              } else {
                this.stormBreaker.reset();
              }
            }
          }

          // tool-error in content
          const content = (event as any).content || [];
          for (const part of content) {
            if (part.type === 'tool-error') {
              this.logger.error(
                `[AgentLoop] tool_error in content: ${part.toolName} id=${part.toolCallId} error="${part.error}"`,
              );
            }
          }
        },
        }),
        {
          maxAttempts: 3,
          shouldRetry: (err) =>
            !this._cancelled && stepsCompleted === 0 && isRetryableError(err),
          onRetry: (attempt, delayMs, err) =>
            this.logger.warn(
              `[AgentLoop] LLM call failed (attempt ${attempt}/3), retrying in ${delayMs}ms: ${(err as Error)?.message ?? err}`,
            ),
        },
      );

      // ── 取消检查 ──
      if (this._cancelled) {
        this.setPhase('cancelled' as LoopPhase);
        return { stopReason: 'cancelled', content: '' };
      }

      const text = result.text || '';

      // ── P0: Token 校准 ──
      const usage = (result as any).usage as
        | { promptTokens: number; completionTokens: number; totalTokens: number }
        | undefined;
      if (usage?.promptTokens) {
        // 用本次的 prompt 文本校准估算器
        const promptChars = slimMessages(this.messages)
          .map((m) => m.content)
          .join('').length + this.systemPrompt.length;
        this.tokenEstimator.calibrate(
          { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens },
          promptChars,
        );
        this.logger.info(
          `[AgentLoop] tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens} tokPerChar=${this.tokenEstimator.currentRatio.toFixed(3)}`,
        );
      }

      // ai-sdk v7 的 response.messages 只包含本次调用新生成的消息，
      // 必须追加到现有历史之后（而非替换），否则刚 push 的 user 消息和
      // 全部历史都会被丢弃。
      this.messages.push(...result.response.messages);

      // StormBreaker 干预消息在合并后按序追加，下一轮调用可见
      if (interventions.length > 0) {
        this.messages.push(...interventions);
      }

      if (text) {
        this.events.onStreamChunk(text);
      }

      this.setPhase('done' as LoopPhase);
      return {
        stopReason: 'end_turn',
        content: text || 'Task completed.',
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            }
          : undefined,
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

  // ── 模型选择（P2） ──

  private selectModel(userText: string): ReturnType<typeof resolveLanguageModel>['model'] {
    if (!this.fastModel) return this.model;

    const userMsgCount = this.messages.filter(
      (m) => m.role === 'user',
    ).length;
    const hasFileRefs =
      /[@.\/\\]/.test(userText) || /\.(go|js|ts|py|rs|java|md)/.test(userText);
    const hasCodeActions =
      /fix|修复|create|创建|write|写|edit|修改|delete|删除|refactor|重构|implement|实现/.test(
        userText,
      );

    const routeCtx = {
      userText,
      hasFileReferences: hasFileRefs,
      hasCodeActions,
      messageLength: userText.length,
      turnNumber: userMsgCount,
    };

    const decision = this.modelRouter.classify(routeCtx);
    if (decision === 'fast') {
      this.logger.info(`[AgentLoop] model routing: fast (turn=${userMsgCount})`);
      return this.fastModel;
    }
    return this.model;
  }

  // ── 调试 ──

  /** 获取当前截断器配置（调试用） */
  getTruncationInfo(): {
    contextWindow: number;
    messageCount: number;
    estimatedTokens: number;
    isCalibrated: boolean;
  } {
    return {
      contextWindow: this.contextWindow,
      messageCount: this.messages.length,
      estimatedTokens: this.tokenEstimator.estimateMessages(
        slimMessages(this.messages),
      ),
      isCalibrated: this.tokenEstimator.isCalibrated,
    };
  }
}
