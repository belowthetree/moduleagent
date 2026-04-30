import { createAgentConnection } from '../protocol/acp/connection.js';
import { FsHandler } from '../protocol/acp/handlers/fs.js';
import { TerminalHandler } from '../protocol/acp/handlers/terminal.js';
import type { ClientSideConnection, Client, SessionNotification } from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';
import type { Logger } from '../core/Logger.js';

export interface AgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface LaunchOptions {
  subModuleDirs?: string[];
}

export interface LaunchedAgent {
  connection: ClientSideConnection;
  process: ChildProcess;
  name: string;
  cwd: string;
  onSessionUpdate: ((moduleName: string, sessionId: string, update: SessionNotification) => void) | null;
}

export class AgentLauncher {
  async launch(config: AgentConfig, name: string, cwd: string, logger?: Logger, options?: LaunchOptions): Promise<LaunchedAgent> {
    cwd = cwd.replace(/\\/g, '/');
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
        console.log(`[${name}] 请求权限: 工具调用 ${params.toolCall.toolCallId}`);
        const options = params.options.map((o) => `  ${o.optionId}: ${o.name}`).join('\n');
        console.log(options);
        console.log('[权限] 自动允许 (开发模式)');
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
          console.log(`[${name}] stream chunk type=${block?.type} len=${block?.text?.length || 0}`);
        } else if (u.sessionUpdate === 'tool_call') {
          console.log(`[${name}] tool_call: ${(u as { title?: string }).title || 'unknown'}`);
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

    const { connection, process } = createAgentConnection(
      {
        command: config.command,
        args: config.args,
        env: config.env,
        cwd,
        logger,
      },
      clientFactory,
    );

    await connection.initialize({
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

    launched.connection = connection;
    launched.process = process;
    return launched;
  }
}
