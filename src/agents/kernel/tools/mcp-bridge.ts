// ---------------------------------------------------------------------------
// mcp-bridge.ts — 跨模块通信工具桥接
// 提供 module_call / module_query / module_list 工具
// 通过 CrossModuleRouter 在进程内直接调用目标 Agent
// ---------------------------------------------------------------------------

import type { CrossModuleRouter } from '../../McpBackend.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createMcpBridgeTools(router: CrossModuleRouter, requestingModule: string): Tool[] {
  const tools: Tool[] = [];

  // ── module_call ──
  const moduleCallSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      targetModule: { type: 'string', description: '目标模块名称' },
      goal: { type: 'string', description: '要完成的子任务描述' },
      background: { type: 'string', description: '任务的背景信息' },
      expectedOutput: { type: 'string', description: '期望的输出格式' },
      constraints: { type: 'string', description: '任务的约束条件（可选）' },
    },
    required: ['targetModule', 'goal', 'background'],
  };

  tools.push({
    name: 'module_call',
    description: '将子任务委托给目标模块的代理执行，等待并接收完整的执行结果。',
    inputSchema: moduleCallSchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await router.routeCall({
        targetModule: input.targetModule as string,
        requestingModule,
        task: formatTaskInput(input),
      });

      if (!result.success) {
        return { content: JSON.stringify({ error: result.error }), metadata: { error: true } };
      }

      return {
        content: result.result || JSON.stringify(result),
        metadata: { tool: 'module_call', targetModule: input.targetModule as string },
      };
    },
  });

  // ── module_query ──
  const moduleQuerySchema: ToolInputSchema = {
    type: 'object',
    properties: {
      targetModule: { type: 'string', description: '目标模块名称' },
      query: { type: 'string', description: '要查询的问题' },
      background: { type: 'string', description: '问题的背景信息' },
    },
    required: ['targetModule', 'query'],
  };

  tools.push({
    name: 'module_query',
    description: '向目标模块的代理查询信息，获取模块状态、结构等信息。',
    inputSchema: moduleQuerySchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await router.routeCall({
        targetModule: input.targetModule as string,
        requestingModule,
        query: input.query as string,
      });

      if (!result.success) {
        return { content: JSON.stringify({ error: result.error }), metadata: { error: true } };
      }

      return {
        content: result.answer || JSON.stringify(result),
        metadata: { tool: 'module_query', targetModule: input.targetModule as string },
      };
    },
  });

  // ── module_list ──
  const moduleListSchema: ToolInputSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  tools.push({
    name: 'module_list',
    description: '列出所有可访问的模块及其描述信息。',
    inputSchema: moduleListSchema,
    execute: async () => {
      const list = router.listModules(requestingModule);
      return {
        content: list,
        metadata: { tool: 'module_list' },
      };
    },
  });

  return tools;
}

function formatTaskInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (input.goal) parts.push(`目标：${input.goal}`);
  if (input.background) parts.push(`背景：${input.background}`);
  if (input.expectedOutput) parts.push(`期望输出：${input.expectedOutput}`);
  if (input.constraints) parts.push(`约束：${input.constraints}`);
  return parts.join('\n');
}
