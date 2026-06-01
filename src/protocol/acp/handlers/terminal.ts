// ---------------------------------------------------------------------------
// protocol/acp/handlers/terminal.ts — ACP 终端处理器
// 管理 Agent 子进程的终端创建、输出采集和生命周期
// ---------------------------------------------------------------------------

import { spawn as cpSpawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  ReleaseTerminalRequest,
} from '@agentclientprotocol/sdk';
import { defaultLogger as log } from '../../../core/Logger.js';

interface TerminalState {
  process: ChildProcess;
  output: string;
  truncated: boolean;
  exitStatus: { exitCode: number; signal: string | null } | null;
  resolved: boolean;
}

export class TerminalHandler {
  private terminals: Map<string, TerminalState> = new Map();
  private terminalCounter = 0;
  private workspaceRoot: string;
  private maxOutputBytes: number;

  constructor(workspaceRoot: string, maxOutputBytes = 1048576) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.maxOutputBytes = maxOutputBytes;
  }

  async create(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term_${++this.terminalCounter}`;

    // 强制终端在 workspaceRoot 内运行
    let cwd = this.workspaceRoot;
    if (params.cwd) {
      const reqCwd = path.resolve(params.cwd);
      if (reqCwd.startsWith(this.workspaceRoot + path.sep) || reqCwd === this.workspaceRoot) {
        cwd = reqCwd;
      } else {
        log.warn(`Terminal cwd outside workspace: ${params.cwd}, forcing to ${this.workspaceRoot}`);
      }
    }

    const env = { ...process.env };
    if (params.env) {
      for (const { name, value } of params.env) {
        env[name] = value;
      }
    }

    const proc = cpSpawn(params.command, params.args || [], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    });

    const state: TerminalState = {
      process: proc,
      output: '',
      truncated: false,
      exitStatus: null,
      resolved: false,
    };

    const byteLimit = params.outputByteLimit ?? this.maxOutputBytes;

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line: string) => {
        if (state.output.length < byteLimit) {
          state.output += line + '\n';
        } else {
          state.truncated = true;
        }
      });
    }

    if (proc.stderr) {
      const rl = createInterface({ input: proc.stderr });
      rl.on('line', (line: string) => {
        if (state.output.length < byteLimit) {
          state.output += line + '\n';
        } else {
          state.truncated = true;
        }
      });
    }

    proc.on('exit', (code, signal) => {
      state.exitStatus = { exitCode: code ?? -1, signal };
      state.resolved = true;
      log.debug(`Terminal ${terminalId} exited: code=${code} signal=${signal}`);
    });

    proc.on('error', () => {
      state.exitStatus = { exitCode: -1, signal: null };
      state.resolved = true;
      log.warn(`Terminal ${terminalId} error`);
    });

    this.terminals.set(terminalId, state);
    log.debug(`Terminal created: ${terminalId} cmd=${params.command} cwd=${cwd}`);
    return { terminalId };
  }

  async getOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const state = this.terminals.get(params.terminalId);
    if (!state) throw new Error(`Terminal not found: ${params.terminalId}`);

    return {
      output: state.output,
      truncated: state.truncated,
      exitStatus: state.exitStatus ?? undefined,
    };
  }

  async waitForExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const state = this.terminals.get(params.terminalId);
    if (!state) throw new Error(`Terminal not found: ${params.terminalId}`);

    if (state.resolved) {
      return state.exitStatus!;
    }

    return new Promise((resolve) => {
      state.process.on('exit', (code, signal) => {
        state.exitStatus = { exitCode: code ?? -1, signal };
        state.resolved = true;
        resolve(state.exitStatus);
      });
    });
  }

  async kill(params: KillTerminalRequest): Promise<void> {
    const state = this.terminals.get(params.terminalId);
    if (!state) throw new Error(`Terminal not found: ${params.terminalId}`);

    if (!state.process.killed) {
      state.process.kill();
      log.info(`Terminal killed: ${params.terminalId}`);
    }
  }

  async release(params: ReleaseTerminalRequest): Promise<void> {
    const state = this.terminals.get(params.terminalId);
    if (state && !state.process.killed) {
      state.process.kill();
    }
    this.terminals.delete(params.terminalId);
    log.info(`Terminal released: ${params.terminalId}`);
  }
}
