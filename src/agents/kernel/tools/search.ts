// ---------------------------------------------------------------------------
// agents/kernel/tools/search.ts — 文件内容搜索工具
// ---------------------------------------------------------------------------

import fs from 'fs-extra';
import path from 'path';
import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createSearchTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '要搜索的正则表达式模式',
      },
      path: {
        type: 'string',
        description: '要搜索的目录路径（相对于工作区根目录，可选）',
      },
      filePattern: {
        type: 'string',
        description: '文件名匹配模式（glob 风格，如 "*.ts"）',
      },
      caseSensitive: {
        type: 'boolean',
        description: '是否区分大小写（默认为 false）',
      },
      maxResults: {
        type: 'number',
        description: '最大返回结果数（默认为 50）',
      },
    },
    required: ['pattern'],
  };

  return {
    name: 'search',
    description: '在可见范围内使用正则表达式搜索文件内容。支持文件名过滤和大小写设置。',
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const pattern = input.pattern as string;
      const searchPath = input.path as string | undefined;
      const filePattern = input.filePattern as string | undefined;
      const caseSensitive = (input.caseSensitive as boolean) ?? false;
      const maxResults = (input.maxResults as number) ?? 50;

      const searchDir = searchPath ? sandbox.resolvePath(searchPath) : sandbox.rootPath;

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      } catch {
        return {
          content: JSON.stringify({ error: `无效的正则表达式: ${pattern}` }),
          metadata: { error: true, code: 'invalid_pattern' },
        };
      }

      const results: { file: string; line: number; content: string }[] = [];
      const fileRegex = filePattern
        ? new RegExp('^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
        : null;

      async function walk(dir: string): Promise<void> {
        if (results.length >= maxResults) return;

        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!sandbox.isPathVisible(fullPath)) continue;
            await walk(fullPath);
          } else if (entry.isFile()) {
            if (!sandbox.isPathVisible(fullPath)) continue;
            if (fileRegex && !fileRegex.test(entry.name)) continue;

            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (regex.test(lines[i]!)) {
                  const relPath = path.relative(sandbox.rootPath, fullPath).replace(/\\/g, '/');
                  results.push({
                    file: relPath,
                    line: i + 1,
                    content: lines[i]!.trim().slice(0, 200),
                  });
                }
              }
            } catch { /* skip */ }
          }
        }
      }

      await walk(searchDir);

      return {
        content: JSON.stringify({ pattern, matchCount: results.length, truncated: results.length >= maxResults, results }),
        metadata: { matchCount: results.length, truncated: results.length >= maxResults },
      };
    },
  };
}
