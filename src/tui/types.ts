export type AgentStatus = 'idle' | 'streaming' | 'error' | 'disconnected' | 'loading';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  time: string;
}

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
