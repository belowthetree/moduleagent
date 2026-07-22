// ---------------------------------------------------------------------------
// agents/kernel/HistoryTruncator.ts — 滑动窗口消息截断器
//
// 对标 Reasonix compact.go 分层压缩策略中的 tail-token-budget 保留机制。
// 在 AgentLoop.send() 调用 LLM 之前检查消息历史长度，
// 若超过上下文窗口阈值则保留 head（首条）+ tail（最近 N 条），
// 中间消息替换为占位标记。
//
// 直接操作 ai-sdk ModelMessage[]，保持每条消息结构合法：
// tail 不会以孤儿 tool 消息开头（其 assistant tool-call 已被截断）。
// ---------------------------------------------------------------------------

import type { ModelMessage } from 'ai';
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
  messages: ModelMessage[];
  /** 被移除的消息数 */
  truncatedCount: number;
  /** 截断前估算 token 数 */
  beforeTokens: number;
  /** 截断后估算 token 数 */
  afterTokens: number;
}

// ── 默认截断标记 ──

const DEFAULT_MARKER =
  '[… 较早的对话已被截断以节省上下文空间 …]';

// ── 估算辅助 ──

/** 提取消息纯文本内容用于 token 估算（结构化 content 序列化） */
export function slimContent(msg: ModelMessage): string {
  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
}

/** 将 ModelMessage 列表映射为 token 估算用的 { role, content } 纯文本形式 */
export function slimMessages(
  messages: ModelMessage[],
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m.role, content: slimContent(m) }));
}

// ── 实现 ──

export class HistoryTruncator {
  private config: TruncationConfig;
  private estimator: TokenEstimator;
  private marker: string;
  private logger: Logger;
  private archive?: (records: ModelMessage[]) => void;

  constructor(
    config: Partial<TruncationConfig> = {},
    estimator: TokenEstimator,
    marker?: string,
    logger?: Logger,
    archive?: (records: ModelMessage[]) => void,
  ) {
    this.config = { ...DEFAULT_TRUNCATION_CONFIG, ...config };
    this.estimator = estimator;
    this.marker = marker ?? DEFAULT_MARKER;
    this.logger = logger || defaultLogger;
    this.archive = archive;
  }

  /**
   * 截断消息历史。
   *
   * 保留规则（对齐 Reasonix planCompaction）：
   * 1. 始终保留第一条 user message（head，承载 module context 注入）
   * 2. 从尾部向前累计，直到达到 tailTokenBudget 或 minKeepMessages
   * 3. 被截断的中间消息合并为一条占位消息
   * 4. tail 不允许以 tool 消息开头——否则其对应的 assistant tool-call
   *    已被截断，孤儿 tool 消息会破坏 ModelMessage 序列结构
   *
   * 注意：head（messages[0]）不包含在返回值中——调用方应自行管理。
   * 返回的是 [marker?, ...tail] 以便调用方拼接 [head, ...result]。
   *
   * @param messages  完整消息历史（包含 head）
   * @returns 截断结果
   */
  truncate(messages: ModelMessage[]): TruncationResult {
    if (messages.length <= 1) {
      // 只有 head，无需截断
      const tokens = this.estimator.estimateMessages(slimMessages(messages));
      return {
        messages: messages.slice(1), // 无 tail
        truncatedCount: 0,
        beforeTokens: tokens,
        afterTokens: tokens,
      };
    }

    const totalTokens = this.estimator.estimateMessages(slimMessages(messages));
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
    const headTokens = this.estimator.estimate(slimContent(head)) + 4;

    const tail: ModelMessage[] = [];
    let tailTokens = 0;

    // 从尾部倒序遍历（跳过 head）
    for (let i = messages.length - 1; i >= 1; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimator.estimate(slimContent(msg)) + 4;

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

    // 丢弃 tail 前部的孤儿 tool 消息（其 assistant tool-call 落在被截断区），
    // 保持消息序列结构合法
    while (tail.length > 0 && tail[0]!.role === 'tool') {
      const dropped = tail.shift()!;
      tailTokens -= this.estimator.estimate(slimContent(dropped)) + 4;
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
    const markerMsg: ModelMessage = { role: 'user', content: this.marker };
    const result: ModelMessage[] = [markerMsg, ...tail];

    // 被丢弃的中间消息存档
    if (this.archive) {
      try {
        this.archive(messages.slice(1, messages.length - tail.length));
      } catch {
        // 存档失败不影响截断
      }
    }

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
