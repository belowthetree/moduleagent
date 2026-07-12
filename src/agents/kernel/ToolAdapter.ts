// ---------------------------------------------------------------------------
// agents/kernel/ToolConverter.ts — 将 Tool 转换为 ai-sdk 兼容格式
// ---------------------------------------------------------------------------

import { tool, jsonSchema } from 'ai';
import type { Tool, ToolInputSchema } from './types.js';
import { defaultLogger } from '../../core/Logger.js';

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
          defaultLogger.error(`[${t.name}] EXCEPTION in execute: ${(err as Error).message} | params=${JSON.stringify(input)}`);
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
  const result: Record<string, any> = {};
  for (const t of tools) {
    Object.assign(result, convertToolToAISDK(t));
  }
  return result;
}
