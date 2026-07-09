// ---------------------------------------------------------------------------
// agents/kernel/tools/execute-command.ts — Shell 命令执行工具
// 限制在工作区内执行，支持超时控制
// ---------------------------------------------------------------------------

import { execFile, type ChildProcess } from 'child_process';
import type { Tool, ToolInputSchema } from '../types.js';
import { resolveSandboxPath } from '../sandbox.js';

export function createExecuteCommandTool(workspaceRoot: string): Tool {
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
      cwd: {
        type: 'string',
        description: '命令执行的工作目录（相对于工作区根目录，可选，默认为工作区根目录）',
      },
      timeout: {
        type: 'number',
        description: '命令超时时间（毫秒，默认为 60000 即 1 分钟）',
      },
    },
    required: ['command'],
  };

  const isWindows = process.platform === 'win32';

  return {
    name: 'execute_command',
    description: `在工作区沙箱内执行 shell 命令。命令在 ${isWindows ? 'cmd /C' : 'sh -c'} 中运行，工作目录限制在工作区内。支持超时控制。`,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const command = input.command as string;
      const cwdRel = input.cwd as string | undefined;
      const timeoutMs = (input.timeout as number) || 60000;

      let cwd = workspaceRoot;
      if (cwdRel) {
        cwd = resolveSandboxPath(workspaceRoot, cwdRel);
      }

      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['/C', command] : ['-c', command];

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const proc: ChildProcess = execFile(shell, shellArgs, {
          cwd,
          env: { ...process.env },
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs);

        proc.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          clearTimeout(timer);

          const output = stdout + (stderr ? '\n[stderr]\n' + stderr : '');
          const truncated = output.length > 10000;

          if (timedOut) {
            resolve({
              content: JSON.stringify({
                success: false,
                exitCode: -1,
                output: output.slice(0, 10000),
                error: `Command timed out after ${timeoutMs}ms`,
                timedOut: true,
              }),
              metadata: { exitCode: -1, success: false, timedOut: true },
            });
            return;
          }

          resolve({
            content: JSON.stringify({
              success: code === 0,
              exitCode: code ?? -1,
              output: truncated ? output.slice(0, 10000) : output,
              truncated,
            }),
            metadata: {
              exitCode: code ?? -1,
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
              success: code === 0,
            },
          });
        });

        proc.on('error', (err: Error) => {
          clearTimeout(timer);
          resolve({
            content: JSON.stringify({
              success: false,
              exitCode: -1,
              output: '',
              error: err.message,
            }),
            metadata: { exitCode: -1, success: false },
          });
        });
      });
    },
  };
}
