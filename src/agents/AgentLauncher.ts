// ---------------------------------------------------------------------------
// AgentLauncher.ts — Agent 子进程的统一启动器，负责 spawn 进程、建立 ACP 连接
// 注册文件系统/终端客户端处理器，是所有 Agent 的启动入口
// ---------------------------------------------------------------------------

import path from 'path';
import { createAgentConnection, type AgentConnection } from '../protocol/acp/connection.js';
import { FsHandler } from '../protocol/acp/handlers/fs.js';
import { TerminalHandler } from '../protocol/acp/handlers/terminal.js';
import type { ClientSideConnection, Client, SessionNotification, AgentCapabilities } from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';

export interface AgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  model?: string;
  defaultMode?: string;
}

/** 连接工厂函数签名 — 允许测试注入 FauxAcpAgent。
 * 与 createAgentConnection 签名一致，但 faux 实现忽略 processOptions 中的 command/args，
 * 仅使用 clientFactory 构建内存连接。 */
export type ConnectionFactory = (
  processOptions: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; name?: string; logger?: Logger },
  clientFactory: (agent: unknown) => Client,
) => AgentConnection;

export interface LaunchOptions {
  subModuleDirs?: string[];
  /** 测试注入：替换 spawn 连接为内存 faux connection */
  createConnection?: ConnectionFactory;
}

export interface LaunchedAgent {
  connection: ClientSideConnection;
  process: ChildProcess;
  name: string;
  cwd: string;
  agentCapabilities?: AgentCapabilities;
  onSessionUpdate: ((moduleName: string, sessionId: string, update: SessionNotification) => void) | null;
}

export class AgentLauncher {
  async launch(config: AgentConfig, name: string, cwd: string, logger?: Logger, options?: LaunchOptions): Promise<LaunchedAgent> {
    const log = logger || defaultLogger;
    cwd = cwd.replace(/\\/g, '/');
    log.info(`Agent launch: ${name} cwd=${cwd} cmd=${config.command}`);

    const fsHandler = new FsHandler(cwd, options?.subModuleDirs || []);
    const terminalHandler = new TerminalHandler(cwd);

    const launched: LaunchedAgent = {
      connection: null as unknown as ClientSideConnection,
      process: null as unknown as ChildProcess,
      name,
      cwd,
      onSessionUpdate: null,
    };

    const clientFactory = (): Client => ({
      requestPermission: async (params) => {
        const toolCall = params.toolCall;
        log.info(`[${name}] Permission requested: ${toolCall.title || 'unknown'} (${JSON.stringify(toolCall)})`);

        // 检查工具 rawInput 中的路径是否在 agent cwd 内
        const rawInput = (toolCall.rawInput || {}) as Record<string, unknown>;
        const pathKeys = ['filePath', 'filepath', 'path', 'directory', 'parentDir',
          'sourcePath', 'targetPath', 'file', 'dir', 'folder'];
        const pathsToCheck: string[] = [];
        for (const key of pathKeys) {
          const v = rawInput[key];
          if (typeof v === 'string' && v.length > 0) pathsToCheck.push(v);
        }
        for (const p of pathsToCheck) {
          const resolved = path.resolve(p).replace(/\\/g, '/');
          const normalizedCwd = cwd.replace(/\\/g, '/');
          if (!resolved.startsWith(normalizedCwd + '/') && resolved !== normalizedCwd) {
            const reason = `Path "${p}" is outside workspace (${normalizedCwd}). Use files within the workspace.`;
            log.warn(`[${name}] Permission REJECTED: ${reason}`);
            // 通过 sessionUpdate 注入 tool_call error，让模型看到被拒原因
            if (launched.onSessionUpdate) {
              launched.onSessionUpdate(name, params.sessionId, {
                update: {
                  sessionUpdate: 'tool_call',
                  title: toolCall.title || 'unknown',
                  status: 'error',
                  toolCallId: toolCall.toolCallId,
                  rawInput: { error: reason },
                },
              } as any);
            }
            return {
              outcome: {
                outcome: 'selected' as const,
                optionId: (params.options.find(o => o.kind === 'reject_once')?.optionId
                  || params.options[0]?.optionId
                  || 'reject_once'),
              } as any,
            };
          }
        }

        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: params.options[0]?.optionId || 'allow-once',
          },
        };
      },

      sessionUpdate: async (params) => {
        const u = params.update;
        if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') {
          const block = (u as { content: { type?: string; text?: string } }).content;
          log.debug(`[${name}] ${u.sessionUpdate} type=${block?.type} len=${block?.text?.length || 0}`);
        } else if (u.sessionUpdate === 'tool_call') {
          log.info(`[${name}] tool_call: ${(u as { title?: string }).title || 'unknown'} ${JSON.stringify(params)}`);
        }
        if (launched.onSessionUpdate) {
          launched.onSessionUpdate(name, params.sessionId, params);
        }
      },

      readTextFile: (params) => fsHandler.readFile(params),
      writeTextFile: async (params) => { await fsHandler.writeFile(params); return {}; },
      createTerminal: (params) => terminalHandler.create(params),
      terminalOutput: (params) => terminalHandler.getOutput(params),
      waitForTerminalExit: (params) => terminalHandler.waitForExit(params),
      killTerminal: (params) => terminalHandler.kill(params),
      releaseTerminal: (params) => terminalHandler.release(params),
    });

    const connectionFactory = options?.createConnection ?? createAgentConnection;
    const { connection, process } = connectionFactory(
      { command: config.command, args: config.args, env: config.env, cwd, name, logger: log },
      clientFactory,
    ) as AgentConnection & { connection: ClientSideConnection; process: ChildProcess };

    const initResult = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
      clientInfo: {
        name: `module-agent-${name}`,
        title: 'ModuleAgent',
        version: '0.1.0',
      },
    });

    launched.agentCapabilities = initResult.agentCapabilities;
    log.info(`Agent initialized: ${name} capabilities=${JSON.stringify(initResult.agentCapabilities)}`);

    launched.connection = connection;
    launched.process = process;
    return launched;
  }
}
