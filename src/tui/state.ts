import { createSignal } from 'solid-js';
import type { AgentStatus, ChatMessage, CommandDef, TuiScreen } from './types.js';

export interface ReactiveTuiState {
  screen: () => TuiScreen;
  setScreen: (v: TuiScreen) => void;
  agentStatus: () => AgentStatus;
  setAgentStatus: (v: AgentStatus) => void;
  currentAgent: () => string;
  setCurrentAgent: (v: string) => void;
  workingDir: () => string;
  setWorkingDir: (v: string) => void;
  messages: () => ChatMessage[];
  setMessages: (v: ChatMessage[]) => void;
  inputValue: () => string;
  setInputValue: (v: string) => void;
  showCommands: () => boolean;
  setShowCommands: (v: boolean) => void;
  commands: () => CommandDef[];
  setCommands: (v: CommandDef[]) => void;
  setupStep: () => number;
  setSetupStep: (v: number) => void;
  setupData: () => Record<string, string>;
  setSetupData: (v: Record<string, string>) => void;
}

export function createTuiState(): ReactiveTuiState {
  const [screen, setScreen] = createSignal<TuiScreen>('chat');
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>('loading');
  const [currentAgent, setCurrentAgent] = createSignal('main');
  const [workingDir, setWorkingDir] = createSignal('');
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [inputValue, setInputValue] = createSignal('');
  const [showCommands, setShowCommands] = createSignal(false);
  const [commands, setCommands] = createSignal<CommandDef[]>([]);
  const [setupStep, setSetupStep] = createSignal(0);
  const [setupData, setSetupData] = createSignal<Record<string, string>>({});

  return {
    screen,
    setScreen,
    agentStatus,
    setAgentStatus,
    currentAgent,
    setCurrentAgent,
    workingDir,
    setWorkingDir,
    messages,
    setMessages,
    inputValue,
    setInputValue,
    showCommands,
    setShowCommands,
    commands,
    setCommands,
    setupStep,
    setSetupStep,
    setupData,
    setSetupData,
  };
}

export const tuiState = createTuiState();
