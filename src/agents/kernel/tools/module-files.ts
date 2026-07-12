// ---------------------------------------------------------------------------
// agents/kernel/tools/module-files.ts — 根模块专属文件工具
// 严格限定在 .module-agent/module/ 目录内操作模块描述文件
// ---------------------------------------------------------------------------

import type { AgentSandbox } from '../Sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';
import { defaultLogger } from '../../../core/Logger.js';

export function createReadModuleFileTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要读取的模块文件路径（相对于 .module-agent/module/ 目录）',
      },
    },
    required: ['filePath'],
  };

  return {
    name: 'read_module_file',
    description: '读取 .module-agent/module/ 下的模块描述文件。filePath 为相对路径（如 "packages/agent/module.md"）。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;

      try {
        const content = await sandbox.readFile(filePath);
        defaultLogger.info(`[read_module_file] filePath="${filePath}" size=${content.length}`);
        return {
          content: content,
          metadata: { filePath, size: content.length },
        };
      } catch (err) {
        defaultLogger.error(`[read_module_file] FAILED filePath="${filePath}" error="${(err as Error).message}"`);
        throw err;
      }
    },
  };
}

export function createWriteModuleFileTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: '要写入的模块文件路径（相对于 .module-agent/module/ 目录）',
      },
      content: {
        type: 'string',
        description: '要写入的文件内容',
      },
    },
    required: ['filePath', 'content'],
  };

  return {
    name: 'write_module_file',
    description: '写入 .module-agent/module/ 下的模块描述文件。filePath 为相对路径（如 "packages/agent/module.md"）。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const filePath = input.filePath as string;
      const content = input.content as string;

      try {
        await sandbox.writeFile(filePath, content);
        defaultLogger.info(`[write_module_file] filePath="${filePath}" size=${content.length}`);
        return {
          content: `文件已写入: ${filePath} (${content.length} 个字符)`,
          metadata: { filePath, size: content.length },
        };
      } catch (err) {
        defaultLogger.error(`[write_module_file] FAILED filePath="${filePath}" error="${(err as Error).message}"`);
        throw err;
      }
    },
  };
}

export function createModuleFileTools(sandbox: AgentSandbox): Tool[] {
  return [
    createReadModuleFileTool(sandbox),
    createWriteModuleFileTool(sandbox),
  ];
}
