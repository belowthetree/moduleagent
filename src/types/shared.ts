// ---------------------------------------------------------------------------
// types/shared.ts — 共享类型定义
// 包含 Agent 状态、聊天消息、差异对比、工作流、知识库等跨层共享的类型
// ---------------------------------------------------------------------------

export type AgentStatus = 'idle' | 'streaming' | 'error' | 'stopped';

export interface AgentStatusData {
  name: string;
  status: AgentStatus;
}

export interface TreeNode {
  name: string;
  path: string;
  description: string;
  children: TreeNode[];
  cwd: string;
}

export interface ScanResult {
  root?: string;
  moduleCount?: number;
  error?: string;
}

export interface TimelineEvent {
  type: 'thinking' | 'tool_call';
  content: string;
  detail?: string;
  toolCallId?: string;
  crossDirection?: 'sent' | 'received';
  crossModule?: string;
  crossPhase?: 'request' | 'response';
}

export interface LayoutNode {
  data: TreeNode;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  subtreeHeight: number;
  parentName: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'agent' | 'cross' | 'tool' | 'system';
  content: string;
  thinking: string;
  tools?: string;
  timeline?: TimelineEvent[];
  time: string;
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted';
  moduleName: string;
  agentCmd?: string;
  sessionId?: string;
  crossDirection?: 'sent' | 'received';
  crossModule?: string;
  crossPhase?: 'request' | 'response';
}

export interface AgentStreamData {
  moduleName: string;
  // sessionId 由 main.ts 在 onSessionUpdate 中发送，但之前缺少在 preload/renderer 回调类型中
  sessionId?: string;
  update: string;
  data: Record<string, unknown>;
  reply?: string;
  thinking?: string;
  tools?: string;
  timeline?: TimelineEvent[];
  sections?: { thinking: boolean; tools: boolean; reply: boolean };
}

export interface CrossContextData {
  moduleName: string;
  crossModule: string;
  direction: 'sent' | 'received';
  phase: 'request' | 'response';
  content: string;
  time: string;
}

export interface RoleConfigData {
  name: string;
  description: string;
  visibleModulePaths: string[];
  agents: {
    default: {
      command?: string;
      args?: string[];
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      fastModel?: string;
      contextWindow?: number;
    };
  };
  knowledgeRefs?: { filename: string; name: string }[];
}

export interface KnowledgeEntry {
  name: string;
  filename: string;
  content: string;
}

export interface KnowledgeListItem {
  name: string;
  filename: string;
}

// ── Workflow types (shared with renderer) ──

export interface WorkflowListItem {
  name: string;
  stepCount: number;
}

export interface WorkflowStepDetail {
  name: string;
  dir: string;
  definition: {
    name: string;
    description?: string;
    input?: { from: string; sourceStep?: string };
    acceptance?: { criteria: string };
    agent?: {
      command?: string;
      args?: string[];
      visibleModulePaths?: string[];
      knowledgeRefs?: { filename: string; name: string }[];
    };
  };
  body: string;
}

export interface WorkflowDetail {
  name: string;
  dir: string;
  steps: WorkflowStepDetail[];
}

export interface WorkflowStepResultItem {
  stepName: string;
  success: boolean;
  outputDir: string;
  completedAt: string;
  acceptancePassed?: boolean;
  error?: string;
}

export interface WorkflowStatus {
  status: string;
  currentStep: number;
  totalSteps: number;
  results: WorkflowStepResultItem[];
}

export interface StepEditData {
  name: string;
  description?: string;
  input?: { from: string; sourceStep?: string };
  acceptance?: { criteria: string };
  agent?: {
    command?: string;
    args?: string[];
    visibleModulePaths?: string[];
    knowledgeRefs?: { filename: string; name: string }[];
  };
  body: string;
}

export interface ModuleAgentApi {
  selectDir(title: string): Promise<string | null>;

  scanProject(projectRoot: string): Promise<ScanResult>;

  generateModules(projectRoot: string): Promise<{ success: boolean; count: number; error?: string }>;

  getTree(): Promise<TreeNode | null>;

  startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }>;

  sendMessage(moduleName: string, text: string, cwd?: string): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: TimelineEvent[]; stopReason?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }; error?: string }>;

  cancelAgent(moduleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; timeline?: TimelineEvent[]; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>;

  onAgentStream(callback: (data: AgentStreamData) => void): () => void;

  onAgentStatus(callback: (data: AgentStatusData) => void): () => void;

  saveAgentConfig(
    projectRoot: string,
    provider: string,
    apiKey: string,
    baseUrl: string,
    model: string,
    projectPath?: string,
    summarizationEnabled?: boolean,
  ): Promise<{ success: boolean; error?: string }>;

  getAgentConfig(projectRoot: string): Promise<{
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    projectPath?: string;
    summarizationEnabled?: boolean;
  }>;

  getContext(moduleName: string): Promise<ChatMsg[]>;

  clearContext(moduleName: string): Promise<void>;

  clearAllContexts(): Promise<void>;

  onCrossContext(callback: (data: CrossContextData) => void): () => void;

  // ── 角色 Agent API ──
  getRoles(): Promise<RoleConfigData[]>;
  saveRole(role: RoleConfigData): Promise<{ success: boolean }>;
  deleteRole(name: string): Promise<{ success: boolean }>;

  startRoleAgent(roleName: string): Promise<{ sessionId?: string; error?: string }>;
  sendRoleMessage(roleName: string, text: string): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: TimelineEvent[]; stopReason?: string }; error?: string }>;
  cancelRoleAgent(roleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; timeline?: TimelineEvent[]; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>;
  stopRoleAgent(roleName: string): Promise<{}>;
  isRoleAgentRunning(roleName: string): Promise<boolean>;

  getRoleContext(roleName: string): Promise<ChatMsg[]>;
  clearRoleContext(roleName: string): Promise<void>;

  onRoleAgentStream(callback: (data: AgentStreamData) => void): () => void;
  onRoleAgentStatus(callback: (data: AgentStatusData) => void): () => void;

  // ── 知识 API ──
  knowledgeList(): Promise<KnowledgeListItem[]>;
  knowledgeRead(filename: string): Promise<KnowledgeEntry | null>;
  knowledgeSave(entry: KnowledgeEntry): Promise<{ success: boolean }>;
  knowledgeCreate(name: string): Promise<KnowledgeEntry | { error: string }>;
  knowledgeDelete(filename: string): Promise<{ success: boolean }>;

  // ── 工作流 API ──
  workflowList(): Promise<WorkflowListItem[]>;
  workflowLoad(name: string): Promise<WorkflowDetail | { error: string }>;
  workflowCreate(name: string): Promise<{ success: boolean; error?: string }>;
  workflowDelete(name: string): Promise<{ success: boolean }>;
  workflowStepSave(wfName: string, stepName: string, content: string): Promise<{ success: boolean }>;
  workflowStepDelete(wfName: string, stepName: string): Promise<{ success: boolean }>;
  workflowStepAdd(wfName: string): Promise<{ success: boolean; stepName?: string; error?: string }>;
  workflowExecute(name: string, userInput?: string): Promise<{ success: boolean; results?: WorkflowStepResultItem[]; error?: string }>;
  workflowCancel(name: string): Promise<void>;
  workflowStatus(name: string): Promise<WorkflowStatus | null>;

}

declare global {
  interface Window {
    moduleAgent: ModuleAgentApi;
  }
}
