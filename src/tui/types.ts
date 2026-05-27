import type { ChatMsg } from '../types/shared.js';

export type AgentStatus = 'idle' | 'streaming' | 'error' | 'disconnected' | 'loading';

/** TUI 消息类型 — 派生自共享 ChatMsg，仅使用 TUI 所需的字段子集 */
export type ChatMessage = Pick<ChatMsg, 'id' | 'role' | 'content' | 'time'>;

export interface CommandDef {
  name: string;
  description: string;
  handler: () => void;
  requiresArg?: boolean;
}

export type TuiScreen = 'setup' | 'chat';

export interface TuiState {
  screen: TuiScreen;
  agentStatus: AgentStatus;
  currentAgent: string;
  workingDir: string;
  messages: ChatMessage[];
  inputValue: string;
  showCommands: boolean;
  commands: CommandDef[];
  setupStep: number;
  setupData: Record<string, string>;
}
