import { Transport, type TransportOptions } from './Transport.js';
import { ACPSession, type SessionHandlers } from './ACPSession.js';
import type {
  InitializeResult,
  SessionNewResult,
  SessionPromptResult,
  MCPServerConfig,
  SessionUpdate,
  SessionUpdateParams,
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
  FsReadTextFileParams,
  FsReadTextFileResult,
  FsWriteTextFileParams,
  TerminalCreateParams,
  TerminalCreateResult,
  TerminalOutputParams,
  TerminalOutputResult,
  TerminalWaitForExitParams,
  TerminalWaitForExitResult,
  AgentCapabilities,
  AgentInfo,
} from './types.js';

export interface ACPClientOptions extends TransportOptions {
  clientName?: string;
  clientVersion?: string;
  fsEnabled?: boolean;
  terminalEnabled?: boolean;
  defaultHandlers?: SessionHandlers;
}

export class ACPClient {
  private transport: Transport;
  private sessions: Map<string, ACPSession> = new Map();
  private agentCaps: AgentCapabilities | null = null;
  private agentInfoObj: AgentInfo | null = null;
  private ready = false;
  private opts: ACPClientOptions;

  constructor(options: ACPClientOptions) {
    this.transport = new Transport();
    this.opts = options;
  }

  get isReady(): boolean { return this.ready; }
  get capabilities(): AgentCapabilities | null { return this.agentCaps; }
  get agentInfo(): AgentInfo | null { return this.agentInfoObj; }

  async start(): Promise<void> {
    this.transport.onRequest(async (method, params) => {
      return this.handleAgentRequest(method, params);
    });
    this.transport.onNotification((method, params) => {
      this.handleAgentNotification(method, params);
    });
    await this.transport.start(this.opts);
  }

  async initialize(): Promise<InitializeResult> {
    const result = await this.transport.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: this.opts.fsEnabled ?? true,
          writeTextFile: this.opts.fsEnabled ?? true,
        },
        terminal: this.opts.terminalEnabled ?? true,
      },
      clientInfo: {
        name: this.opts.clientName || 'module-agent',
        title: 'ModuleAgent',
        version: this.opts.clientVersion || '0.1.0',
      },
    }) as InitializeResult;

    this.agentCaps = result.agentCapabilities;
    this.agentInfoObj = result.agentInfo;
    this.ready = true;
    return result;
  }

  async createSession(cwd: string, mcpServers?: MCPServerConfig[], handlers?: SessionHandlers): Promise<string> {
    if (!this.ready) throw new Error('Client not initialized');

    const result = await this.transport.sendRequest('session/new', { cwd, mcpServers }) as SessionNewResult;
    const session = new ACPSession(result.sessionId, handlers || this.opts.defaultHandlers);
    this.sessions.set(result.sessionId, session);
    return result.sessionId;
  }

  async prompt(sessionId: string, content: string | { type: 'text'; text: string }[]): Promise<SessionPromptResult> {
    if (!this.sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);

    const prompt = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
    return await this.transport.sendRequest('session/prompt', { sessionId, prompt }) as SessionPromptResult;
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.transport.sendNotification('session/cancel', { sessionId });
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.transport.sendRequest('session/close', { sessionId });
    } catch {}
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): ACPSession | undefined {
    return this.sessions.get(sessionId);
  }

  async stop(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      try {
        this.transport.sendNotification('session/cancel', { sessionId: id });
        await this.transport.sendRequest('session/close', { sessionId: id });
      } catch {}
    }
    this.sessions.clear();
    await this.transport.stop();
    this.ready = false;
  }

  private async handleAgentRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    const session = params?.sessionId ? this.sessions.get(params.sessionId as string) : undefined;
    const h = session?.handlers;

    switch (method) {
      case 'session/request_permission': {
        if (h?.onPermissionRequest) {
          return h.onPermissionRequest(params as unknown as SessionRequestPermissionParams);
        }
        return { outcome: { outcome: 'cancelled' } };
      }
      case 'fs/read_text_file': {
        if (h?.onFsRead) {
          return h.onFsRead(params as unknown as FsReadTextFileParams);
        }
        throw new Error('fs/read_text_file not supported by session handler');
      }
      case 'fs/write_text_file': {
        if (h?.onFsWrite) {
          await h.onFsWrite(params as unknown as FsWriteTextFileParams);
          return {};
        }
        throw new Error('fs/write_text_file not supported by session handler');
      }
      case 'terminal/create': {
        if (h?.onTerminalCreate) {
          return h.onTerminalCreate(params as unknown as TerminalCreateParams);
        }
        throw new Error('terminal/create not supported by session handler');
      }
      case 'terminal/output': {
        if (h?.onTerminalOutput) {
          return h.onTerminalOutput(params as unknown as TerminalOutputParams);
        }
        throw new Error('terminal/output not supported by session handler');
      }
      case 'terminal/wait_for_exit': {
        if (h?.onTerminalWaitForExit) {
          return h.onTerminalWaitForExit(params as unknown as TerminalWaitForExitParams);
        }
        throw new Error('terminal/wait_for_exit not supported by session handler');
      }
      case 'terminal/kill': {
        if (h?.onTerminalKill) {
          await h.onTerminalKill(params as { terminalId: string });
          return {};
        }
        throw new Error('terminal/kill not supported by session handler');
      }
      case 'terminal/release': {
        if (h?.onTerminalRelease) {
          await h.onTerminalRelease(params as { terminalId: string });
          return {};
        }
        throw new Error('terminal/release not supported by session handler');
      }
      default:
        throw new Error(`Unknown request method: ${method}`);
    }
  }

  private handleAgentNotification(method: string, params: Record<string, unknown> | undefined): void {
    if (method === 'session/update' && params) {
      const { sessionId, update } = params as unknown as SessionUpdateParams;
      const session = this.sessions.get(sessionId);
      if (session) {
        session.addUpdate(update);
      }
    }
  }
}
