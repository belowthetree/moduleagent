import type { ChatMsg } from '../types/shared.js';

export type AgentStatus = 'idle' | 'streaming' | 'error' | 'disconnected' | 'loading';

/** TUI 消息子类型 — 用于区分展示样式 */
export type MessageType = 'user' | 'agent_reply' | 'agent_thought' | 'tool_call' | 'system' | 'cross_context';

/** TUI 消息类型 — 派生自共享 ChatMsg，扩展 msgType 用于分类渲染 */
export type ChatMessage = Pick<ChatMsg, 'id' | 'role' | 'content' | 'time'> & {
  msgType: MessageType;
};

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
  currentTarget: string;       // 'module' | 'role' | 'workflow'
  workingDir: string;
  messages: ChatMessage[];
  inputValue: string;
  showCommands: boolean;
  commands: CommandDef[];
  setupStep: number;
  setupData: Record<string, string>;
  showThought: boolean;        // 思考内容可见性
  collapsedThoughts: Set<string>; // 已折叠的推理消息 ID
  inputHistory: string[];       // 输入历史
  historyIndex: number;         // 当前历史位置
  activeCounts: { modules: number; roles: number; workflows: number };
}
