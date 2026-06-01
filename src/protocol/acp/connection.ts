// ---------------------------------------------------------------------------
// protocol/acp/connection.ts — ACP 连接管理器
// 创建 Agent 子进程、建立 ACP 协议连接（ndjson 流）、处理握手/初始化/会话管理
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { Readable, Writable } from 'node:stream';
import fs from 'fs';
import path from 'path';
import { ClientSideConnection, ndJsonStream, type Client, type Agent } from '@agentclientprotocol/sdk';
import type { Logger } from '../../core/Logger.js';

export interface AgentProcessOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  name?: string;
  logger?: Logger;
}

export interface AgentConnection {
  connection: ClientSideConnection;
  process: ChildProcess;
}

export function createAgentConnection(
  options: AgentProcessOptions,
  clientFactory: (agent: Agent) => Client,
): AgentConnection {
  const { command, args = [], env, name, logger } = options;
  const cwd = options.cwd?.replace(/\\/g, '/');
  const { cmd, resolvedArgs, shell } = resolveCommand(command, args);

  logger?.info(`CONNECTION [${name || 'unknown'}] spawning: ${cmd} ${resolvedArgs.join(' ')} (cwd: ${cwd || process.cwd()})`);

  const childProcess = spawn(cmd, resolvedArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd,
    windowsHide: true,
    ...(shell !== undefined ? { shell } : {}),
  });

  childProcess.on('error', (err) => {
    logger?.error(`CONNECTION [${name || 'unknown'}] process error: ${err.message}`);
  });

  childProcess.on('exit', (code) => {
    logger?.info(`CONNECTION [${name || 'unknown'}] process exited (code: ${code})`);
  });

  if (childProcess.stderr) {
    const rl = createInterface({ input: childProcess.stderr });
    rl.on('line', (line: string) => {
      logger?.info(`STDERR: ${line.slice(0, 500)}`);
    });
  }

  const readable = Readable.toWeb(childProcess.stdout!) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(childProcess.stdin!) as WritableStream<Uint8Array>;
  const stream = ndJsonStream(writable, readable);

  const connection = new ClientSideConnection(clientFactory, stream);

  return { connection, process: childProcess };
}

export function resolveCommand(command: string, args: string[]): { cmd: string; resolvedArgs: string[]; shell?: boolean } {
  if (process.platform !== 'win32' || command.includes('/') || command.includes('\\')) {
    return { cmd: command, resolvedArgs: args };
  }

  const npmPrefix = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '';
  const cmdPath = path.join(npmPrefix, command + '.cmd');
  if (fs.existsSync(cmdPath)) {
    try {
      const content = fs.readFileSync(cmdPath, 'utf-8');
      const match = content.match(/"%_prog%"\s+"([^"]+)"/);
      if (match) {
        const scriptRel = match[1]!.replace(/%dp0%\\?/g, '');
        const scriptPath = path.join(path.dirname(cmdPath), scriptRel);
        if (fs.existsSync(scriptPath)) {
          const nodeExe = findNodeExe();
          if (nodeExe) {
            return { cmd: nodeExe, resolvedArgs: [scriptPath, ...args] };
          }
        }
      }
    } catch {}

    // 回退：通过 cmd.exe 启动以确保 .cmd 被正确处理
    return { cmd: 'cmd.exe', resolvedArgs: ['/c', cmdPath, ...args], shell: false };
  }

  return { cmd: command, resolvedArgs: args };
}

function findNodeExe(): string | null {
  const progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(progFiles, 'nodejs', 'node.exe'),
    path.join(progFilesX86, 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'nodejs', 'node.exe'),
    'node.exe',
  ];

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}
