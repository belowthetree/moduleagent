// ---------------------------------------------------------------------------
// agents/kernel/tools/execute-command.ts — Shell 命令执行工具
// ---------------------------------------------------------------------------

import { execFile, type ChildProcess } from 'child_process';
import type { AgentSandbox } from '../Sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';
import { defaultLogger } from '../../../core/Logger.js';

/**
 * 子进程环境变量白名单：仅保留运行命令所必需的项，
 * 避免把 ANTHROPIC_API_KEY 等敏感变量泄漏给任意命令。
 */
const ENV_WHITELIST = [
  'PATH', 'SystemRoot', 'SystemDrive', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'OS', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'SHELL', 'TERM', 'COLORTERM',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
];

/** 按白名单构建子进程环境（Windows 环境变量名不区分大小写） */
export function buildSafeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const isWin = process.platform === 'win32';
  for (const key of Object.keys(process.env)) {
    const allowed = ENV_WHITELIST.some(w =>
      isWin ? key.toUpperCase() === w.toUpperCase() : key === w,
    );
    if (allowed) env[key] = process.env[key];
  }
  return env;
}

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
    description: `在受限工作目录内执行 shell 命令。命令在 ${isWindows ? 'cmd /C' : 'sh -c'} 中运行，工作目录限制在可见范围内，环境变量经白名单过滤；注意命令本身不受文件系统沙箱约束，可读写工作目录之外的路径，请谨慎使用。`,
    inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const command = input.command as string;
      const cwdRel = input.cwd as string | undefined;
      const timeoutMs = (input.timeout as number) || 60000;

      defaultLogger.info(`[execute_command] command="${command}" cwd=${cwdRel ?? '.'} timeout=${timeoutMs}`);

      let cwd: string;
      try {
        cwd = sandbox.resolveCommandCwd(cwdRel);
      } catch (err) {
        defaultLogger.error(`[execute_command] FAILED (resolveCwd) command="${command}" error="${(err as Error).message}"`);
        return {
          content: JSON.stringify({ success: false, exitCode: -1, output: '', error: (err as Error).message }),
          metadata: { exitCode: -1, success: false },
        };
      }

      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['/C', command] : ['-c', command];

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const proc: ChildProcess = execFile(shell, shellArgs, {
          cwd,
          env: buildSafeEnv(),
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
            defaultLogger.warn(`[execute_command] TIMED_OUT command="${command}" timeout=${timeoutMs}`);
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

          defaultLogger.info(`[execute_command] done exitCode=${code} stdout_len=${stdout.length} stderr_len=${stderr.length}`);

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
          defaultLogger.error(`[execute_command] FAILED command="${command}" error="${err.message}"`);
          resolve({
            content: JSON.stringify({ success: false, exitCode: -1, output: '', error: err.message }),
            metadata: { exitCode: -1, success: false },
          });
        });
      });
    },
  };
}
