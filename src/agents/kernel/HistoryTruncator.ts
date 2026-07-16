// ---------------------------------------------------------------------------
// agents/kernel/HistoryTruncator.ts — 滑动窗口消息截断器
//
// 对标 Reasonix compact.go 分层压缩策略中的 tail-token-budget 保留机制。
// 在 AgentLoop.send() 调用 LLM 之前检查消息历史长度，
// 若超过上下文窗口阈值则保留 head（首条）+ tail（最近 N 条），
// 中间消息替换为占位标记。
// ---------------------------------------------------------------------------

import { TokenEstimator } from '../../core/TokenEstimator.js';
import { defaultLogger, type Logger } from '../../core/Logger.js';

// ── 配置 ──

export interface TruncationConfig {
  /** 上下文窗口总 token 数（从 provider 配置获取，默认 128K） */
  contextWindow: number;
  /** 触发截断的阈值比例（默认 0.8，对齐 Reasonix compactRatio） */
  truncateRatio: number;
  /** 截断后保留最近消息的 token 预算（默认 16384，对齐 Reasonix tail_tokens） */
  tailTokenBudget: number;
  /** 最小保留消息数（默认 2，对齐 Reasonix minRecentKeep） */
  minKeepMessages: number;
}

export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  contextWindow: 128_000,
  truncateRatio: 0.8,
  tailTokenBudget: 16_384,
  minKeepMessages: 2,
};

// ── 结果 ──

export interface TruncationResult {
  /** 截断后的消息数组（不包含 head——head 由调用方单独管理） */
  messages: Array<{ role: string; content: string }>;
  /** 被移除的消息数 */
  truncatedCount: number;
  /** 截断前估算 token 数 */
  beforeTokens: number;
  /** 截断后估算 token 数 */
  afterTokens: number;
}

// ── 内部消息类型 ──

interface SlimMsg {
  role: string;
  content: string;
}

// ── 默认截断标记 ──

const DEFAULT_MARKER =
  '[… 较早的对话已被截断以节省上下文空间 …]';

// ── 实现 ──

export class HistoryTruncator {
  private config: TruncationConfig;
  private estimator: TokenEstimator;
  private marker: string;
  private logger: Logger;

  constructor(
    config: Partial<TruncationConfig> = {},
    estimator: TokenEstimator,
    marker?: string,
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_TRUNCATION_CONFIG, ...config };
    this.estimator = estimator;
    this.marker = marker ?? DEFAULT_MARKER;
    this.logger = logger || defaultLogger;
  }

  /**
   * 截断消息历史。
   *
   * 保留规则（对齐 Reasonix planCompaction）：
   * 1. 始终保留第一条 user message（head，承载 module context 注入）
   * 2. 从尾部向前累计，直到达到 tailTokenBudget 或 minKeepMessages
   * 3. 被截断的中间消息合并为一条占位消息
   *
   * 注意：head（messages[0]）不包含在返回值中——调用方应自行管理。
   * 返回的是 [marker?, ...tail] 以便调用方拼接 [head, ...result]。
   *
   * @param messages  完整消息历史（包含 head）
   * @returns 截断结果
   */
  truncate(messages: SlimMsg[]): TruncationResult {
    if (messages.length <= 1) {
      // 只有 head，无需截断
      const tokens = this.estimator.estimateMessages(messages);
      return {
        messages: messages.slice(1), // 无 tail
        truncatedCount: 0,
        beforeTokens: tokens,
        afterTokens: tokens,
      };
    }

    const totalTokens = this.estimator.estimateMessages(messages);
    const threshold = this.config.contextWindow * this.config.truncateRatio;

    if (totalTokens <= threshold) {
      return {
        messages: messages.slice(1),
        truncatedCount: 0,
        beforeTokens: totalTokens,
        afterTokens: totalTokens,
      };
    }

    // ── 分区: head(0) | middle(1..N-k) | tail(N-k..) ──
    const head = messages[0]!;
    const headTokens = this.estimator.estimate(head.content ?? '') + 4;

    const tail: SlimMsg[] = [];
    let tailTokens = 0;

    // 从尾部倒序遍历（跳过 head）
    for (let i = messages.length - 1; i >= 1; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimator.estimate(msg.content ?? '') + 4;

      if (
        tailTokens + msgTokens <= this.config.tailTokenBudget ||
        tail.length < this.config.minKeepMessages
      ) {
        tail.unshift(msg);
        tailTokens += msgTokens;
      } else {
        break;
      }
    }

    const truncatedCount = messages.length - 1 - tail.length;
    if (truncatedCount <= 0) {
      return {
        messages: messages.slice(1),
        truncatedCount: 0,
        beforeTokens: totalTokens,
        afterTokens: totalTokens,
      };
    }

    // 构建结果: [marker, ...tail]
    const markerMsg: SlimMsg = { role: 'user', content: this.marker };
    const result = [markerMsg, ...tail];
    const afterTokens =
      headTokens +
      this.estimator.estimate(this.marker) +
      tailTokens +
      (tail.length + 1) * 4;

    this.logger.warn(
      `HistoryTruncator: truncated ${truncatedCount}/${messages.length} msgs ` +
      `(tokens: ${totalTokens}→${afterTokens}, ` +
      `threshold=${threshold}, tailBudget=${this.config.tailTokenBudget}, ` +
      `window=${this.config.contextWindow})`,
    );

    return {
      messages: result,
      truncatedCount,
      beforeTokens: totalTokens,
      afterTokens,
    };
  }

  /** 更新配置（运行时调整） */
  updateConfig(partial: Partial<TruncationConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
