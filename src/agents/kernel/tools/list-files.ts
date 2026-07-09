// ---------------------------------------------------------------------------
// agents/kernel/tools/list-files.ts — 目录列表工具
// 在工作区内列出文件和子目录
// ---------------------------------------------------------------------------

import { safeListDir } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createListFilesTool(workspaceRoot: string): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要列出的目录路径（相对于工作区根目录，可选，默认为工作区根目录）',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出所有子目录（默认为 false）',
      },
      maxDepth: {
        type: 'number',
        description: '最大递归深度（默认为 3，仅在 recursive 为 true 时有效）',
      },
    },
    required: [],
  };

  return {
    name: 'list_files',
    description: '列出工作区内的文件和目录。支持递归浏览和深度控制。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const dirPath = (input.path as string) || '.';
      const recursive = (input.recursive as boolean) ?? false;
      const maxDepth = (input.maxDepth as number) ?? 3;

      const entries = await safeListDir(workspaceRoot, dirPath, { recursive, maxDepth });

      return {
        content: JSON.stringify({
          path: dirPath,
          entryCount: entries.length,
          entries,
        }),
        metadata: { path: dirPath, entryCount: entries.length },
      };
    },
  };
}
