// ---------------------------------------------------------------------------
// agents/kernel/ToolOutputTruncator.ts — 工具输出智能截断
//
// 对标 Reasonix agent.go:36 maxToolOutputBytes + prune.go 分层截断策略。
// 包装 Tool.execute()，按工具类型分策略截断输出：
//   - 只读工具：保留更多头部（文件内容通常在开头）
//   - 命令执行：保留更多尾部（错误信息常出现在末尾）
// ---------------------------------------------------------------------------

import type { Tool } from './types.js';
import { defaultLogger, type Logger } from '../../core/Logger.js';

// ── 截断规则 ──

export interface TruncationRule {
  /** 最大输出字符数 */
  maxChars: number;
  /** 保留头部字符数 */
  headChars: number;
  /** 保留尾部字符数 */
  tailChars: number;
}

/**
 * 按工具类型的截断规则表。
 * 对齐 Reasonix snipStrategyFor() 的分策略设计：
 *   - 只读工具：前 80 行 + 后 12 行
 *   - bash（有副作用）：前 40 行 + 后 40 行
 */
export const TOOL_TRUNCATION_RULES: Record<string, TruncationRule> = {
  // 默认规则：~2K tokens
  __default__: { maxChars: 8_000, headChars: 6_000, tailChars: 2_000 },

  // 只读工具：保留更多头部
  file_read: { maxChars: 12_000, headChars: 10_000, tailChars: 2_000 },
  search: { maxChars: 10_000, headChars: 8_000, tailChars: 2_000 },
  list_files: { maxChars: 20_000, headChars: 18_000, tailChars: 2_000 },

  // 命令执行：保留更多尾部（错误信息在末尾）
  execute_command: { maxChars: 10_000, headChars: 4_000, tailChars: 6_000 },

  // 文件编辑/写入：输出通常很短，阈值放宽
  file_write: { maxChars: 4_000, headChars: 3_000, tailChars: 1_000 },
  file_edit: { maxChars: 4_000, headChars: 3_000, tailChars: 1_000 },

  // MCP bridge 工具（跨模块通信）：保留全部
  module_call: { maxChars: 50_000, headChars: 40_000, tailChars: 10_000 },
  module_query: { maxChars: 20_000, headChars: 16_000, tailChars: 4_000 },
  module_list: { maxChars: 10_000, headChars: 8_000, tailChars: 2_000 },

  // module_context 工具（按需文档）：保留全部
  module_context_read_full: { maxChars: 100_000, headChars: 90_000, tailChars: 10_000 },
  module_context_read_patterns: { maxChars: 30_000, headChars: 25_000, tailChars: 5_000 },
  module_context_read_experience: { maxChars: 20_000, headChars: 16_000, tailChars: 4_000 },
};

// ── 截断器 ──

export class ToolOutputTruncator {
  /**
   * 包装单个 Tool.execute()，自动截断超长输出。
   */
  static wrap(tool: Tool): Tool {
    const rule: TruncationRule = TOOL_TRUNCATION_RULES[tool.name] ?? TOOL_TRUNCATION_RULES.__default__!;
    const originalExecute = tool.execute.bind(tool);

    return {
      ...tool,
      async execute(input) {
        const result = await originalExecute(input);

        if (result.content.length <= rule.maxChars) {
          return result;
        }

        const head = result.content.slice(0, rule.headChars);
        const tail = result.content.slice(-rule.tailChars);
        const truncated = result.content.length - rule.headChars - rule.tailChars;
        const toolName = tool.name;

        defaultLogger.warn(
          `ToolOutputTruncator [${toolName}]: output truncated ` +
          `${result.content.length}→${rule.maxChars} chars ` +
          `(head=${rule.headChars} tail=${rule.tailChars})`,
        );

        return {
          content:
            head +
            `\n\n[... ${truncated.toLocaleString()} 字符已截断，原始长度 ${result.content.length.toLocaleString()} ...]\n\n` +
            tail,
          metadata: {
            ...result.metadata,
            truncated: true,
            originalLength: result.content.length,
          },
        };
      },
    };
  }

  /** 批量包装 */
  static wrapAll(tools: Tool[]): Tool[] {
    return tools.map((t) => ToolOutputTruncator.wrap(t));
  }
}
