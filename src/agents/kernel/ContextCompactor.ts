// ---------------------------------------------------------------------------
// agents/kernel/ContextCompactor.ts — 在线上下文压缩
//
// 对标 Reasonix compact.go 的分层压缩策略。
// 当消息历史超过阈值时，调用轻量 summarizer LLM 生成摘要，
// 将中间消息折叠为单条 summary 消息。
// 失败时静默降级（返回原消息不压缩），由 HistoryTruncator 兜底。
//
// 直接操作 ai-sdk ModelMessage[]：折叠区整段替换为 summary 消息，
// 保持剩余消息结构合法（tail 不会以孤儿 tool 消息开头）。
// ---------------------------------------------------------------------------

import { generateText, type ModelMessage } from 'ai';
import { TokenEstimator } from '../../core/TokenEstimator.js';
import { withRetry } from '../../core/RetryPolicy.js';
import { slimContent, slimMessages } from './HistoryTruncator.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

// ── 配置 ──

export interface CompactionConfig {
  /** 触发压缩的 token 阈值比例（默认 0.7） */
  compactRatio: number;
  /** 保留原文的尾部 token 预算（默认 16384，对齐 Reasonix） */
  tailTokenBudget: number;
  /** 至少折叠多少 token 才值得调用总结 LLM（默认 400，对齐 Reasonix foldEconomics） */
  minFoldableTokens: number;
  /** 两次压缩的最小间隔（ms，默认 60000） */
  minIntervalMs: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  compactRatio: 0.7,
  tailTokenBudget: 16_384,
  minFoldableTokens: 400,
  minIntervalMs: 60_000,
};

// ── 结果 ──

export interface CompactionResult {
  /** 压缩后的消息数组（保持与 ai-sdk 兼容的格式） */
  messages: ModelMessage[];
  /** 是否执行了压缩 */
  compacted: boolean;
  /** 被折叠的消息数 */
  foldedCount: number;
  /** 压缩前后 token 数 */
  beforeTokens: number;
  afterTokens: number;
}

// ── 实现 ──

export class ContextCompactor {
  private config: CompactionConfig;
  private estimator: TokenEstimator;
  private summarizerModel: any; // LanguageModel
  private logger: Logger;
  private lastCompactionTime = 0;
  private archive?: (records: ModelMessage[]) => void;

  constructor(
    config: Partial<CompactionConfig>,
    estimator: TokenEstimator,
    summarizerModel: any,
    logger?: Logger,
    archive?: (records: ModelMessage[]) => void,
  ) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.estimator = estimator;
    this.summarizerModel = summarizerModel;
    this.logger = logger || defaultLogger;
    this.archive = archive;
  }

  /**
   * 检查是否需要压缩，若需要则执行。
   * 若经济性不划算（foldable < minFoldableTokens）或距上次压缩不足 minIntervalMs，则跳过。
   *
   * @param messages 当前完整消息历史（ModelMessage 数组）
   * @param windowTokens 上下文窗口 token 数
   */
  async maybeCompact(
    messages: ModelMessage[],
    windowTokens: number,
  ): Promise<CompactionResult> {
    if (messages.length <= 2) {
      return {
        messages,
        compacted: false,
        foldedCount: 0,
        beforeTokens: 0,
        afterTokens: 0,
      };
    }

    const beforeTokens = this.estimator.estimateMessages(slimMessages(messages));
    const threshold = windowTokens * this.config.compactRatio;

    if (beforeTokens <= threshold) {
      return {
        messages,
        compacted: false,
        foldedCount: 0,
        beforeTokens,
        afterTokens: beforeTokens,
      };
    }

    // 频率控制
    const now = Date.now();
    if (now - this.lastCompactionTime < this.config.minIntervalMs) {
      return {
        messages,
        compacted: false,
        foldedCount: 0,
        beforeTokens,
        afterTokens: beforeTokens,
      };
    }

    // ── 分区: head(0) | foldable | tail ──
    const head = messages[0]!;
    const tail: ModelMessage[] = [];
    let tailTokens = 0;

    for (let i = messages.length - 1; i >= 1; i--) {
      const msg = messages[i]!;
      const t = this.estimator.estimate(slimContent(msg)) + 4;
      if (tailTokens + t <= this.config.tailTokenBudget) {
        tail.unshift(msg);
        tailTokens += t;
      } else {
        break;
      }
    }

    // tail 不允许以 tool 消息开头——其对应的 assistant tool-call 在 foldable 中，
    // 折叠后会留下孤儿 tool 消息。将这类消息并回 foldable 以保持配对完整。
    let foldableEnd = messages.length - tail.length;
    while (tail.length > 0 && tail[0]!.role === 'tool') {
      const moved = tail.shift()!;
      tailTokens -= this.estimator.estimate(slimContent(moved)) + 4;
      foldableEnd++;
    }

    const foldable = messages.slice(1, foldableEnd);
    const headTokens = this.estimator.estimate(slimContent(head)) + 4;
    const foldableTokens = beforeTokens - headTokens - tailTokens;

    if (foldableTokens < this.config.minFoldableTokens || foldable.length === 0) {
      return {
        messages,
        compacted: false,
        foldedCount: 0,
        beforeTokens,
        afterTokens: beforeTokens,
      };
    }

    // 调用 summarizer LLM
    try {
      const summary = await this.summarize(foldable);
      this.lastCompactionTime = now;

      // 被折叠的原始消息存档
      if (this.archive) {
        try {
          this.archive(foldable);
        } catch {
          // 存档失败不影响压缩
        }
      }

      const summaryMsg: ModelMessage = {
        role: 'user',
        content: `[对话摘要 — 已压缩 ${foldable.length} 条消息]\n\n${summary}`,
      };

      const result: ModelMessage[] = [head, summaryMsg, ...tail];
      const afterTokens =
        headTokens +
        this.estimator.estimate(summaryMsg.content as string) +
        tailTokens +
        (tail.length + 1) * 4;

      this.logger.info(
        `[ContextCompactor] compacted ${foldable.length} msgs, tokens: ${beforeTokens}→${afterTokens}`,
      );

      return {
        messages: result,
        compacted: true,
        foldedCount: foldable.length,
        beforeTokens,
        afterTokens,
      };
    } catch (err) {
      this.logger.warn(
        `[ContextCompactor] summarize failed: ${(err as Error).message} — falling back to truncation`,
      );
      return {
        messages,
        compacted: false,
        foldedCount: 0,
        beforeTokens,
        afterTokens: beforeTokens,
      };
    }
  }

  /**
   * 调用 summmarizer LLM 生成对话摘要。
   * 使用轻量模型（fastModel），限制输出 1000 tokens。
   */
  private async summarize(messages: ModelMessage[]): Promise<string> {
    const conversation = messages
      .map((m) => {
        const content = slimContent(m);
        const truncated =
          content.length > 2000
            ? content.slice(0, 2000) + '…'
            : content;
        return `[${m.role}]: ${truncated}`;
      })
      .join('\n\n');

    const result = await withRetry(
      () => generateText({
        model: this.summarizerModel,
        system:
          '你是一个对话摘要器。将以下 Agent 对话压缩为简洁摘要，保留：关键决策、文件修改、错误和解决方案。用中文输出。',
        prompt: `请摘要以下对话：\n\n${conversation}`,
        maxOutputTokens: 1000,
      }),
      { maxAttempts: 2 },
    );

    return result.text || '(摘要生成失败)';
  }
}
