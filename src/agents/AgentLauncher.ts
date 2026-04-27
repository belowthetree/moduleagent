import { ACPClient, type ACPClientOptions } from '../protocol/acp/ACPClient.js';
import { FsHandler } from '../protocol/acp/handlers/fs.js';
import { TerminalHandler } from '../protocol/acp/handlers/terminal.js';

export interface AgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface LaunchedAgent {
  client: ACPClient;
  name: string;
  cwd: string;
}

export class AgentLauncher {
  async launch(config: AgentConfig, name: string, cwd: string): Promise<LaunchedAgent> {
    const fsHandler = new FsHandler(cwd);
    const terminalHandler = new TerminalHandler(cwd);

    const client = new ACPClient({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd,
      clientName: `module-agent-${name}`,
      fsEnabled: true,
      terminalEnabled: true,
      defaultHandlers: {
        onPermissionRequest: async (params) => {
          console.log(`[${name}] 请求权限: 工具调用 ${params.toolCall.toolCallId}`);
          const options = params.options.map((o) => `  ${o.optionId}: ${o.name}`).join('\n');
          console.log(options);
          console.log('[权限] 自动允许 (开发模式)');
          return { outcome: { outcome: 'selected', optionId: params.options[0]?.optionId || 'allow-once' } };
        },
        onFsRead: (params) => fsHandler.readFile(params),
        onFsWrite: (params) => fsHandler.writeFile(params),
        onTerminalCreate: (params) => terminalHandler.create(params),
        onTerminalOutput: (params) => terminalHandler.getOutput(params),
        onTerminalWaitForExit: (params) => terminalHandler.waitForExit(params),
        onTerminalKill: (params) => terminalHandler.kill(params.terminalId),
        onTerminalRelease: (params) => terminalHandler.release(params.terminalId),
      },
    });

    await client.start();
    await client.initialize();

    return { client, name, cwd };
  }
}
