// ---------------------------------------------------------------------------
// agents/kernel/tools/list-files.ts — 目录列表工具
// ---------------------------------------------------------------------------

import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createListFilesTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要列出的目录路径（相对于工作区根目录，可选）',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出所有子目录（默认为 false）',
      },
      maxDepth: {
        type: 'number',
        description: '最大递归深度（默认为 3）',
      },
    },
    required: [],
  };

  return {
    name: 'list_files',
    description: '列出可见范围内的文件和目录。支持递归浏览和深度控制。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const dirPath = (input.path as string) || '.';
      const recursive = (input.recursive as boolean) ?? false;
      const maxDepth = (input.maxDepth as number) ?? 3;

      const entries = await sandbox.listDir(dirPath, { recursive, maxDepth });

      return {
        content: JSON.stringify({ path: dirPath, entryCount: entries.length, entries }),
        metadata: { path: dirPath, entryCount: entries.length },
      };
    },
  };
}
