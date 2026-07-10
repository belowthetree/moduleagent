// ---------------------------------------------------------------------------
// agents/kernel/tools/git-operations.ts — Git 操作工具
// ---------------------------------------------------------------------------

import { execFile, type ChildProcess } from 'child_process';
import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

const ALLOWED_OPERATIONS = [
  'status', 'diff', 'log', 'add', 'commit',
  'branch', 'checkout', 'show', 'stash',
];

export function createGitOperationsTool(sandbox: AgentSandbox): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: `Git 操作类型：${ALLOWED_OPERATIONS.join(', ')}`,
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Git 命令的附加参数',
      },
      message: {
        type: 'string',
        description: '提交信息（仅在 operation 为 commit 时需要）',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: '要操作的文件列表（相对于工作区根目录）',
      },
      repoPath: {
        type: 'string',
        description: 'Git 仓库路径（相对于工作区根目录，可选）',
      },
    },
    required: ['operation'],
  };

  return {
    name: 'git_operations',
    description: `在可见范围内的 Git 仓库中执行常用 git 操作。支持：${ALLOWED_OPERATIONS.join(', ')}。`,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const operation = input.operation as string;
      const args = (input.args as string[] | undefined) || [];
      const message = input.message as string | undefined;
      const files = (input.files as string[] | undefined) || [];
      const repoPath = input.repoPath as string | undefined;

      if (!ALLOWED_OPERATIONS.includes(operation)) {
        return {
          content: JSON.stringify({
            error: `不支持的 git 操作: ${operation}。允许的操作：${ALLOWED_OPERATIONS.join(', ')}`,
          }),
          metadata: { error: true, code: 'invalid_operation' },
        };
      }

      const cwd = repoPath ? sandbox.resolvePath(repoPath) : sandbox.rootPath;

      const cmdArgs: string[] = [operation];
      if (message && operation === 'commit') cmdArgs.push('-m', message);
      for (const f of files) {
        sandbox.resolvePath(f);
        cmdArgs.push(f);
      }
      cmdArgs.push(...args);

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc: ChildProcess = execFile('git', cmdArgs, {
          cwd,
          env: { ...process.env },
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
        });

        proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', (code: number | null) => {
          const output = stdout.slice(0, 10000);
          const truncated = stdout.length > 10000;

          if (code !== 0 && stderr) {
            resolve({
              content: JSON.stringify({ success: false, operation, output, error: stderr.slice(0, 5000) }),
              metadata: { operation, success: false, exitCode: code ?? -1 },
            });
          } else {
            resolve({
              content: JSON.stringify({ success: true, operation, output, truncated }),
              metadata: { operation, success: true, exitCode: code ?? 0 },
            });
          }
        });

        proc.on('error', (err: Error) => {
          resolve({
            content: JSON.stringify({ success: false, operation, output: '', error: err.message }),
            metadata: { operation, success: false, exitCode: -1 },
          });
        });
      });
    },
  };
}
