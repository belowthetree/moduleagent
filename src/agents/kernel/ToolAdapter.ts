// ---------------------------------------------------------------------------
// agents/kernel/ToolConverter.ts — 将 Tool 转换为 ai-sdk 兼容格式
// ---------------------------------------------------------------------------

import { tool, jsonSchema } from 'ai';
import type { Tool, ToolInputSchema } from './types.js';
import { defaultLogger } from '../../core/Logger.js';
import { ToolOutputTruncator } from './ToolOutputTruncator.js';

// ── 日志脱敏 ──

/** 敏感参数键名（值在日志中替换为 ***） */
const SENSITIVE_KEY = /api[-_]?key|token|secret|password/i;
/** 日志中参数序列化的最大长度 */
const PARAMS_LOG_MAX_CHARS = 500;

/** 递归脱敏：敏感键的值替换为 ***（限制深度防止过深遍历） */
function maskSensitive(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '***' : maskSensitive(v, depth + 1);
  }
  return out;
}

/** 参数日志序列化：脱敏 + 截断（避免 file_write 完整内容写入日志） */
function formatParamsForLog(input: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(maskSensitive(input));
  } catch {
    json = String(input);
  }
  return json.length > PARAMS_LOG_MAX_CHARS
    ? json.slice(0, PARAMS_LOG_MAX_CHARS) + '…'
    : json;
}

export function convertToolToAISDK(t: Tool): Record<string, unknown> {
  const schema = t.inputSchema as ToolInputSchema;
  return {
    [t.name]: tool({
      description: t.description,
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: schema.type || 'object',
        properties: schema.properties || {},
        required: schema.required || [],
        additionalProperties: schema.additionalProperties ?? false,
      }),
      execute: async (input: Record<string, unknown>) => {
        if (typeof input !== 'object' || input === null) {
          input = {};
        }
        try {
          const result = await t.execute(input as Record<string, unknown>);
          if (result.metadata?.error) {
            defaultLogger.warn(`[${t.name}] returned metadata.error code=${result.metadata.code}`);
            throw new Error(result.content);
          }
          return result.content;
        } catch (err) {
          defaultLogger.error(`[${t.name}] EXCEPTION in execute: ${(err as Error).message} | params=${formatParamsForLog(input)}`);
          throw err;
        }
      },
    }),
  };
}

export function convertToolDefinitionToAISDK(t: Tool): { type: 'function'; name: string; description: string; parameters: any } {
  return {
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  };
}

export function convertToolsToAISDK(tools: Tool[]): Record<string, any> {
  // P1: 包装工具输出截断
  const wrapped = ToolOutputTruncator.wrapAll(tools);
  const result: Record<string, any> = {};
  for (const t of wrapped) {
    Object.assign(result, convertToolToAISDK(t));
  }
  return result;
}
