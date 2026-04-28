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
  const { command, args = [], env, logger } = options;
  const cwd = options.cwd?.replace(/\\/g, '/');
  const { cmd, resolvedArgs } = resolveCommand(command, args);

  logger?.info(`CONNECTION spawning: ${cmd} ${resolvedArgs.join(' ')} (cwd: ${cwd || process.cwd()})`);

  const childProcess = spawn(cmd, resolvedArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd,
    windowsHide: true,
  });

  childProcess.on('error', (err) => {
    logger?.error(`CONNECTION process error: ${err.message}`);
  });

  childProcess.on('exit', (code) => {
    logger?.info(`CONNECTION agent process exited (code: ${code})`);
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

export function resolveCommand(command: string, args: string[]): { cmd: string; resolvedArgs: string[] } {
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
          return { cmd: 'node', resolvedArgs: [scriptPath, ...args] };
        }
      }
    } catch {}
  }

  return { cmd: command, resolvedArgs: args };
}
