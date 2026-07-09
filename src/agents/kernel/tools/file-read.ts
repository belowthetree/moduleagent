// ---------------------------------------------------------------------------
// agents/kernel/tools/file-read.ts — 文件读取工具
// 沙箱限制，仅允许读取工作区内的文件
// ---------------------------------------------------------------------------

import { safeReadFile } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createFileReadTool(workspaceRoot: string): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要读取的文件路径（相对于工作区根目录）',
      },
      offset: {
        type: 'number',
        description: '起始行号（从 1 开始，可选）',
      },
      limit: {
        type: 'number',
        description: '要读取的最大行数（可选）',
      },
    },
    required: ['filePath'],
  };

  return {
    name: 'file_read',
    description: '读取工作区内的文件内容。可以指定行范围进行部分读取。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;

      const content = await safeReadFile(workspaceRoot, filePath, { offset, limit });

      return {
        content: content,
        metadata: { filePath, size: content.length },
      };
    },
  };
}
