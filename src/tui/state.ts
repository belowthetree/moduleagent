// ---------------------------------------------------------------------------
// tui/state.ts — TUI 响应式状态
// SolidJS 信号驱动的全局状态管理，包含消息、状态、屏幕、历史
// ---------------------------------------------------------------------------

import { createSignal } from 'solid-js';
import type { AgentStatus, ChatMessage, CommandDef, TuiScreen, ExperienceEntry, QuickPanelEntry } from './types.js';
import type { DiffSummary } from '../types/shared.js';

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
  agentCwd: () => string;
  setAgentCwd: (v: string) => void;
  diffPrompt: () => DiffSummary | null;
  setDiffPrompt: (v: DiffSummary | null) => void;
  showDiffPanel: () => boolean;
  setShowDiffPanel: (v: boolean) => void;
  showExperiencePanel: () => boolean;
  setShowExperiencePanel: (v: boolean) => void;
  experienceEntries: () => ExperienceEntry[];
  setExperienceEntries: (v: ExperienceEntry[]) => void;
  experienceModuleIndex: () => number;
  setExperienceModuleIndex: (v: number) => void;
  showQuickPanel: () => boolean;
  setShowQuickPanel: (v: boolean) => void;
  quickPanelEntries: () => QuickPanelEntry[];
  setQuickPanelEntries: (v: QuickPanelEntry[]) => void;
  moduleStatusVersion: () => number;
  setModuleStatusVersion: (v: number) => void;
  quickPanelIndex: () => number;
  setQuickPanelIndex: (v: number) => void;
}

export function createTuiState(): ReactiveTuiState {
  const [screen, setScreen] = createSignal<TuiScreen>('chat');
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>('loading');
  const [currentAgent, setCurrentAgent] = createSignal('');
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
  const [agentCwd, setAgentCwd] = createSignal('');
  const [diffPrompt, setDiffPrompt] = createSignal<DiffSummary | null>(null);
  const [showDiffPanel, setShowDiffPanel] = createSignal(false);
  const [showExperiencePanel, setShowExperiencePanel] = createSignal(false);
  const [experienceEntries, setExperienceEntries] = createSignal<ExperienceEntry[]>([]);
  const [experienceModuleIndex, setExperienceModuleIndex] = createSignal(0);
  const [showQuickPanel, setShowQuickPanel] = createSignal(false);
  const [quickPanelEntries, setQuickPanelEntries] = createSignal<QuickPanelEntry[]>([]);
  const [quickPanelIndex, setQuickPanelIndex] = createSignal(0);
  const [moduleStatusVersion, setModuleStatusVersion] = createSignal(0);

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
    agentCwd,
    setAgentCwd,
    diffPrompt,
    setDiffPrompt,
    showDiffPanel,
    setShowDiffPanel,
    showExperiencePanel,
    setShowExperiencePanel,
    experienceEntries,
    setExperienceEntries,
    experienceModuleIndex,
    setExperienceModuleIndex,
    showQuickPanel,
    setShowQuickPanel,
    quickPanelEntries,
    setQuickPanelEntries,
    quickPanelIndex,
    setQuickPanelIndex,
    moduleStatusVersion,
    setModuleStatusVersion,
  };
}

export const tuiState = createTuiState();
