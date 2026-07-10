// ---------------------------------------------------------------------------
// agents/kernel/tools/file-write.ts — 文件写入工具
// ---------------------------------------------------------------------------

import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createFileWriteTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要写入的文件路径（相对于工作区根目录）',
      },
      content: {
        type: 'string',
        description: '要写入的文件内容',
      },
    },
    required: ['filePath', 'content'],
  };

  return {
    name: 'file_write',
    description: '在可见范围内创建新文件或覆盖已有文件。会自动创建所需的父目录。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;
      const content = input.content as string;

      await sandbox.writeFile(filePath, content);

      return {
        content: `文件已成功写入: ${filePath} (${content.length} 个字符)`,
        metadata: { filePath, size: content.length },
      };
    },
  };
}
