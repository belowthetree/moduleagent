import { createSignal } from 'solid-js';
import type { AgentStatus, ChatMessage, CommandDef, TuiScreen } from './types.js';

export interface ReactiveTuiState {
  screen: () => TuiScreen;
  setScreen: (v: TuiScreen) => void;
  agentStatus: () => AgentStatus;
  setAgentStatus: (v: AgentStatus) => void;
  currentAgent: () => string;
  setCurrentAgent: (v: string) => void;
  currentTarget: () => string;
  setCurrentTarget: (v: string) => void;
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
  showThought: () => boolean;
  setShowThought: (v: boolean) => void;
  collapsedThoughts: () => Set<string>;
  setCollapsedThoughts: (v: Set<string>) => void;
  inputHistory: () => string[];
  setInputHistory: (v: string[]) => void;
  historyIndex: () => number;
  setHistoryIndex: (v: number) => void;
  activeCounts: () => { modules: number; roles: number; workflows: number };
  setActiveCounts: (v: { modules: number; roles: number; workflows: number }) => void;
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
  const [currentTarget, setCurrentTarget] = createSignal('module');
  const [showThought, setShowThought] = createSignal(true);
  const [inputHistory, setInputHistory] = createSignal<string[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [activeCounts, setActiveCounts] = createSignal({ modules: 0, roles: 0, workflows: 0 });
  const [collapsedThoughts, setCollapsedThoughts] = createSignal<Set<string>>(new Set());

  return {
    screen,
    setScreen,
    agentStatus,
    setAgentStatus,
    currentAgent,
    setCurrentAgent,
    currentTarget,
    setCurrentTarget,
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
    showThought,
    setShowThought,
    collapsedThoughts,
    setCollapsedThoughts,
    inputHistory,
    setInputHistory,
    historyIndex,
    setHistoryIndex,
    activeCounts,
    setActiveCounts,
  };
}

export const tuiState = createTuiState();
