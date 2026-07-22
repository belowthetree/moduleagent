// ---------------------------------------------------------------------------
// agents/kernel/tools/git-operations.ts — Git 操作工具
// ---------------------------------------------------------------------------

import { execFile, type ChildProcess } from 'child_process';
import type { AgentSandbox } from '../Sandbox.js';
import type { Tool, ToolInputSchema } from '../types.js';
import { defaultLogger } from '../../../core/Logger.js';
import { buildSafeEnv } from './execute-command.js';

const ALLOWED_OPERATIONS = [
  'status', 'diff', 'log', 'add', 'commit',
  'branch', 'checkout', 'show', 'stash',
];

/**
 * 每个 operation 允许的安全 flag 白名单（从严选取）。
 * 只读 flag 为主；不含任何可写文件（--output）、执行命令（--exec、-c）
 * 或重定向仓库位置（--git-dir、--work-tree）的 flag。
 * 带值 flag 支持 --flag=value 与 --flag value 两种形式。
 */
const ALLOWED_FLAGS: Record<string, string[]> = {
  status: ['--short', '-s', '--long', '--branch', '-b', '--porcelain', '-v', '--verbose', '--untracked-files', '-u', '--ignored'],
  diff: ['--cached', '--staged', '--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '--patch', '-p', '-w', '--ignore-all-space', '--no-color', '--color'],
  log: ['--oneline', '--graph', '--decorate', '--all', '--stat', '--patch', '-p', '--name-only', '--name-status', '--pretty', '--format', '--abbrev-commit', '--max-count', '-n', '--skip', '--since', '--until', '--after', '--before', '--author', '--grep', '--follow', '--first-parent', '--reverse', '--no-color', '--color'],
  add: ['--all', '-A', '--update', '-u', '--force', '-f', '--verbose', '-v', '--dry-run', '-n', '--intent-to-add', '-N'],
  commit: ['--amend', '--no-edit', '--allow-empty', '--allow-empty-message', '--verbose', '-v', '--quiet', '-q', '--no-verify', '--signoff', '-s'],
  branch: ['--all', '-a', '--remotes', '-r', '--verbose', '-v', '-vv', '--list', '--show-current', '--delete', '-d', '-D', '--move', '-m', '-M', '--copy', '-c', '-C', '--no-track', '--track'],
  checkout: ['--branch', '-b', '-B', '--force', '-f', '--detach', '--track', '-t', '--no-track', '--quiet', '-q', '--merge', '-m', '--orphan'],
  show: ['--stat', '--patch', '-p', '--name-only', '--name-status', '--pretty', '--format', '--abbrev-commit', '--no-color', '--color', '--quiet', '-s'],
  stash: ['--keep-index', '--include-untracked', '-u', '--all', '-a', '--patch', '-p', '--quiet', '-q', '--message', '-m', '--stat', '--list', '--show'],
};

/** 校验非 flag 参数（pathspec / flag 值）：拒绝绝对路径和含 ".." 的路径片段 */
function validatePathspec(arg: string): string | null {
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(arg)) {
    return `不允许绝对路径参数: "${arg}"`;
  }
  if (arg.split(/[\\/]/).some(seg => seg === '..')) {
    return `不允许包含 ".." 的参数: "${arg}"`;
  }
  return null;
}

/** 校验 args：flag 按 operation 白名单放行，其余按 pathspec 校验 */
function validateArgs(operation: string, args: string[]): string | null {
  const allowedFlags = ALLOWED_FLAGS[operation] ?? [];
  let pathspecOnly = false; // "--" 之后一律按 pathspec 处理
  for (const arg of args) {
    if (pathspecOnly) {
      const err = validatePathspec(arg);
      if (err) return err;
      continue;
    }
    if (arg === '--') {
      pathspecOnly = true;
      continue;
    }
    if (arg.startsWith('-')) {
      const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (!allowedFlags.includes(flag)) {
        return `不允许的 git 参数: "${arg}"（operation="${operation}" 允许的 flag: ${allowedFlags.join(', ') || '无'}）`;
      }
    } else {
      const err = validatePathspec(arg);
      if (err) return err;
    }
  }
  return null;
}

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
        description: 'Git 命令的附加参数。flag 按 operation 白名单校验，pathspec 不允许绝对路径和 ".."',
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
        defaultLogger.warn(`[git_operations] invalid_operation="${operation}"`);
        return {
          content: JSON.stringify({
            error: `不支持的 git 操作: ${operation}。允许的操作：${ALLOWED_OPERATIONS.join(', ')}`,
          }),
          metadata: { error: true, code: 'invalid_operation' },
        };
      }

      const argsError = validateArgs(operation, args);
      if (argsError) {
        defaultLogger.warn(`[git_operations] invalid_args operation="${operation}" args=${JSON.stringify(args)} reason="${argsError}"`);
        return {
          content: JSON.stringify({ error: argsError }),
          metadata: { error: true, code: 'invalid_args' },
        };
      }

      let cwd: string;
      try {
        cwd = repoPath ? sandbox.resolvePath(repoPath) : sandbox.rootPath;
      } catch (err) {
        defaultLogger.error(`[git_operations] FAILED (resolveRepoPath) operation="${operation}" repoPath="${repoPath}" error="${(err as Error).message}"`);
        return {
          content: JSON.stringify({ success: false, operation, output: '', error: (err as Error).message }),
          metadata: { operation, success: false, exitCode: -1 },
        };
      }

      const cmdArgs: string[] = [operation];
      if (message && operation === 'commit') cmdArgs.push('-m', message);
      try {
        for (const f of files) {
          sandbox.resolvePath(f);
          cmdArgs.push(f);
        }
      } catch (err) {
        defaultLogger.error(`[git_operations] FAILED (resolveFile) operation="${operation}" error="${(err as Error).message}"`);
        return {
          content: JSON.stringify({ success: false, operation, output: '', error: `文件路径不可见: ${(err as Error).message}` }),
          metadata: { operation, success: false, exitCode: -1 },
        };
      }
      cmdArgs.push(...args);

      defaultLogger.info(`[git_operations] operation="${operation}" args=${JSON.stringify(cmdArgs.slice(1))} cwd="${cwd}"`);

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';

        const proc: ChildProcess = execFile('git', cmdArgs, {
          cwd,
          env: buildSafeEnv(),
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
            defaultLogger.warn(`[git_operations] failed operation="${operation}" exitCode=${code} stderr="${stderr.slice(0, 200)}"`);
            resolve({
              content: JSON.stringify({ success: false, operation, output, error: stderr.slice(0, 5000) }),
              metadata: { operation, success: false, exitCode: code ?? -1 },
            });
          } else {
            defaultLogger.info(`[git_operations] done operation="${operation}" exitCode=${code}`);
            resolve({
              content: JSON.stringify({ success: true, operation, output, truncated }),
              metadata: { operation, success: true, exitCode: code ?? 0 },
            });
          }
        });

        proc.on('error', (err: Error) => {
          defaultLogger.error(`[git_operations] FAILED operation="${operation}" error="${err.message}"`);
          resolve({
            content: JSON.stringify({ success: false, operation, output: '', error: err.message }),
            metadata: { operation, success: false, exitCode: -1 },
          });
        });
      });
    },
  };
}
