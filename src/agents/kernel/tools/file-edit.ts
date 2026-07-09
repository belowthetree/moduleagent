// ---------------------------------------------------------------------------
// agents/kernel/tools/file-edit.ts — 文件编辑工具
// 在工作区内对文件进行查找替换
// ---------------------------------------------------------------------------

import { safeReadFile, safeWriteFile } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createFileEditTool(workspaceRoot: string): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要编辑的文件路径（相对于工作区根目录）',
      },
      oldText: {
        type: 'string',
        description: '要替换的原始文本',
      },
      newText: {
        type: 'string',
        description: '替换后的新文本',
      },
    },
    required: ['filePath', 'oldText', 'newText'],
  };

  return {
    name: 'file_edit',
    description: '在工作区内的文件中执行精确的查找替换操作。oldText 必须与文件中的内容完全匹配（包括空白字符）。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;
      const oldText = input.oldText as string;
      const newText = input.newText as string;

      const content = await safeReadFile(workspaceRoot, filePath);

      const count = content.split(oldText).length - 1;
      if (count === 0) {
        return {
          content: JSON.stringify({
            error: `The specified text was not found in ${filePath}. Verify the exact text (including whitespace) and try again.`,
            filePath,
          }),
          metadata: { error: true, code: 'text_not_found' },
        };
      }

      if (count > 1) {
        return {
          content: JSON.stringify({
            error: `Multiple matches (${count}) found for the specified text in ${filePath}. Provide more surrounding context to make the match unique.`,
            filePath,
            matchCount: count,
          }),
          metadata: { error: true, code: 'multiple_matches' },
        };
      }

      const newContent = content.replace(oldText, newText);
      await safeWriteFile(workspaceRoot, filePath, newContent);

      return {
        content: `File edited successfully: ${filePath}`,
        metadata: { filePath, oldSize: content.length, newSize: newContent.length },
      };
    },
  };
}
