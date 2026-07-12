// ---------------------------------------------------------------------------
// agents/kernel/tools/file-edit.ts — 文件编辑工具
// ---------------------------------------------------------------------------

import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';
import { defaultLogger } from '../../../core/Logger.js';

export function createFileEditTool(sandbox: AgentSandbox): Tool {
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
    description: '在可见范围内的文件中执行精确的查找替换操作。oldText 必须与文件中的内容完全匹配。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;
      const oldText = input.oldText as string;
      const newText = input.newText as string;

      try {
        const content = await sandbox.readFile(filePath);

        const count = content.split(oldText).length - 1;
        if (count === 0) {
          defaultLogger.warn(`[file_edit] text_not_found filePath="${filePath}" oldText_len=${oldText.length}`);
          return {
            content: JSON.stringify({
              error: `在 ${filePath} 中未找到指定文本。请验证文本完全匹配（包括空白字符），然后重试。`,
              filePath,
            }),
            metadata: { error: true, code: 'text_not_found' },
          };
        }

        if (count > 1) {
          defaultLogger.warn(`[file_edit] multiple_matches filePath="${filePath}" count=${count}`);
          return {
            content: JSON.stringify({
              error: `在 ${filePath} 中找到多个匹配（${count} 处）。请提供更多上下文以唯一标识要替换的部分。`,
              filePath,
              matchCount: count,
            }),
            metadata: { error: true, code: 'multiple_matches' },
          };
        }

        const newContent = content.replace(oldText, newText);
        await sandbox.writeFile(filePath, newContent);

        defaultLogger.info(`[file_edit] filePath="${filePath}" old_len=${content.length} new_len=${newContent.length}`);

        return {
          content: `文件已成功编辑: ${filePath}`,
          metadata: { filePath, oldSize: content.length, newSize: newContent.length },
        };
      } catch (err) {
        defaultLogger.error(`[file_edit] FAILED filePath="${filePath}" oldText_len=${oldText.length} newText_len=${newText.length} error="${(err as Error).message}"`);
        throw err;
      }
    },
  };
}
