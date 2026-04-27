import type {
  SessionUpdateParams,
  SessionUpdate,
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
} from './types.js';

export interface SessionHandlers {
  onUpdate?: (sessionId: string, update: SessionUpdate) => void;
  onPermissionRequest?: (params: SessionRequestPermissionParams) => Promise<SessionRequestPermissionResult>;
  onFsRead?: (params: FsReadTextFileParams) => Promise<FsReadTextFileResult>;
  onFsWrite?: (params: FsWriteTextFileParams) => Promise<void>;
  onTerminalCreate?: (params: TerminalCreateParams) => Promise<TerminalCreateResult>;
  onTerminalOutput?: (params: TerminalOutputParams) => Promise<TerminalOutputResult>;
  onTerminalWaitForExit?: (params: TerminalWaitForExitParams) => Promise<TerminalWaitForExitResult>;
  onTerminalKill?: (params: { terminalId: string }) => Promise<void>;
  onTerminalRelease?: (params: { terminalId: string }) => Promise<void>;
}

export class ACPSession {
  sessionId: string;
  handlers: SessionHandlers;
  private messageHistory: SessionUpdate[] = [];

  constructor(sessionId: string, handlers: SessionHandlers = {}) {
    this.sessionId = sessionId;
    this.handlers = handlers;
  }

  addUpdate(update: SessionUpdate): void {
    this.messageHistory.push(update);
    if (this.handlers.onUpdate) {
      this.handlers.onUpdate(this.sessionId, update);
    }
  }

  getHistory(): SessionUpdate[] {
    return [...this.messageHistory];
  }
}
