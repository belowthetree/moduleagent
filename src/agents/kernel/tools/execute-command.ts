// ---------------------------------------------------------------------------
// agents/kernel/tools/execute-command.ts — Shell 命令执行工具
// ---------------------------------------------------------------------------

import { execFile, type ChildProcess } from 'child_process';
import type { AgentSandbox } from '../sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';

export function createExecuteCommandTool(sandbox: AgentSandbox): Tool {
  const isWindows = process.platform === 'win32';

  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
      cwd: {
        type: 'string',
        description: '命令执行的工作目录（相对于工作区根目录，可选）',
      },
      timeout: {
        type: 'number',
        description: '命令超时时间（毫秒，默认为 60000）',
      },
    },
    required: ['command'],
  };

  return {
    name: 'execute_command',
    description: `在沙箱内执行 shell 命令。命令在 ${isWindows ? 'cmd /C' : 'sh -c'} 中运行，工作目录限制在可见范围内。`,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const command = input.command as string;
      const cwdRel = input.cwd as string | undefined;
      const timeoutMs = (input.timeout as number) || 60000;

      const cwd = sandbox.resolveCommandCwd(cwdRel);
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

        proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        proc.on('close', (code: number | null) => {
          clearTimeout(timer);
          const output = stdout + (stderr ? '\n[stderr]\n' + stderr : '');
          const truncated = output.length > 10000;

          if (timedOut) {
            resolve({
              content: JSON.stringify({
                success: false, exitCode: -1,
                output: output.slice(0, 10000),
                error: `命令在 ${timeoutMs}ms 后超时`, timedOut: true,
              }),
              metadata: { exitCode: -1, success: false, timedOut: true },
            });
            return;
          }

          resolve({
            content: JSON.stringify({
              success: code === 0, exitCode: code ?? -1,
              output: truncated ? output.slice(0, 10000) : output, truncated,
            }),
            metadata: { exitCode: code ?? -1, stdoutLength: stdout.length, stderrLength: stderr.length, success: code === 0 },
          });
        });

        proc.on('error', (err: Error) => {
          clearTimeout(timer);
          resolve({
            content: JSON.stringify({ success: false, exitCode: -1, output: '', error: err.message }),
            metadata: { exitCode: -1, success: false },
          });
        });
      });
    },
  };
}
