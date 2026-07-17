// ---------------------------------------------------------------------------
// agents/kernel/ToolResultSnipper.ts — 旧工具结果精简（snip）
//
// 对标 Reasonix prune.go 的 SnipStaleToolResults：
// 当上下文超过 snipRatio（默认 60%）时，将历史中较旧的超长工具结果
// 截断为「头 + 尾」，原文存档。零 LLM 成本，在 compact/truncate 之前执行。
// ---------------------------------------------------------------------------

import { TokenEstimator } from '../../core/TokenEstimator.js';
import { TOOL_TRUNCATION_RULES, type TruncationRule } from './ToolOutputTruncator.js';
import type { ArchiveWriter } from './ArchiveWriter.js';
import { defaultLogger, type Logger } from '../../core/Logger.js';

// ── 配置 ──

export interface SnipConfig {
  /** 触发 snip 的 token 阈值比例（默认 0.6） */
  snipRatio: number;
  /** 尾部保护消息数（默认 4，最近的工具结果不动） */
  protectTailMsgs: number;
  /** 超过该字符数的工具结果才 snip（默认 2000） */
  minSnipChars: number;
}

export const DEFAULT_SNIP_CONFIG: SnipConfig = {
  snipRatio: 0.6,
  protectTailMsgs: 4,
  minSnipChars: 2_000,
};

// ── 结果 ──

export interface SnipResult {
  snippedCount: number;
  beforeTokens: number;
  afterTokens: number;
}

const SNIP_MARKER = '已精简存档';

interface SlimMsg {
  role: string;
  content: string;
}

export class ToolResultSnipper {
  private config: SnipConfig;
  private estimator: TokenEstimator;
  private archive?: ArchiveWriter;
  private logger: Logger;

  constructor(
    config: Partial<SnipConfig>,
    estimator: TokenEstimator,
    archive?: ArchiveWriter,
    logger?: Logger,
  ) {
    this.config = { ...DEFAULT_SNIP_CONFIG, ...config };
    this.estimator = estimator;
    this.archive = archive;
    this.logger = logger || defaultLogger;
  }

  /**
   * 对超阈值的历史执行 snip。原地修改 messages 中的工具结果内容。
   * 跳过 head（首条，承载模块上下文注入）和最近 protectTailMsgs 条。
   */
  snipStale(messages: any[], contextWindow: number): SnipResult {
    const before = this._estimate(messages);
    const empty = { snippedCount: 0, beforeTokens: before, afterTokens: before };

    if (before <= contextWindow * this.config.snipRatio) return empty;
    if (messages.length <= 1 + this.config.protectTailMsgs) return empty;

    const archiveRecords: Record<string, unknown>[] = [];
    let snippedCount = 0;
    const lastIndex = messages.length - this.config.protectTailMsgs;

    for (let i = 1; i < lastIndex; i++) {
      const msg = messages[i];
      if (msg?.role !== 'tool') continue;
      snippedCount += this._snipToolMessage(msg, archiveRecords);
    }

    if (snippedCount > 0) {
      this.archive?.('tool-results.jsonl', archiveRecords);
      this.logger.info(
        `[ToolResultSnipper] snipped ${snippedCount} stale tool result(s), ` +
        `tokens: ${before}→${this._estimate(messages)}`,
      );
    }

    return { snippedCount, beforeTokens: before, afterTokens: this._estimate(messages) };
  }

  // ── 内部 ──

  private _snipToolMessage(msg: any, archiveRecords: Record<string, unknown>[]): number {
    let count = 0;
    const toolName: string = msg.toolName ?? msg.name ?? '';
    const fallbackRule = TOOL_TRUNCATION_RULES[toolName] ?? TOOL_TRUNCATION_RULES.__default__!;

    // ai-sdk v5: { role:'tool', content: [{ type:'tool-result', toolName, output:{type:'text',value} }] }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== 'tool-result') continue;
        const name: string = part.toolName ?? toolName;
        const rule = TOOL_TRUNCATION_RULES[name] ?? fallbackRule;
        const out = part.output;
        if (out && typeof out === 'object' && typeof out.value === 'string') {
          const snipped = this._snipText(out.value, rule, name, part.toolCallId, archiveRecords);
          if (snipped !== out.value) { out.value = snipped; count++; }
        } else if (typeof out === 'string') {
          const snipped = this._snipText(out, rule, name, part.toolCallId, archiveRecords);
          if (snipped !== out) { part.output = snipped; count++; }
        }
      }
      return count;
    }

    // 兜底：{ role:'tool', content: string }
    if (typeof msg.content === 'string') {
      const snipped = this._snipText(msg.content, fallbackRule, toolName, msg.toolCallId, archiveRecords);
      if (snipped !== msg.content) { msg.content = snipped; count++; }
    }

    return count;
  }

  private _snipText(
    text: string,
    rule: TruncationRule,
    toolName: string,
    toolCallId: unknown,
    archiveRecords: Record<string, unknown>[],
  ): string {
    if (text.length <= this.config.minSnipChars) return text;
    if (text.includes(SNIP_MARKER)) return text;

    archiveRecords.push({
      ts: new Date().toISOString(),
      toolCallId,
      toolName,
      content: text,
    });

    const head = text.slice(0, rule.headChars);
    const tail = text.slice(-rule.tailChars);
    return (
      head +
      `\n\n[... ${SNIP_MARKER}，原始长度 ${text.length.toLocaleString()}，见 archives/tool-results.jsonl ...]\n\n` +
      tail
    );
  }

  private _estimate(messages: any[]): number {
    const slim: SlimMsg[] = messages.map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    return this.estimator.estimateMessages(slim);
  }
}
