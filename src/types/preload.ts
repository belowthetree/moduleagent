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
}

export interface ScanResult {
  root?: string;
  moduleCount?: number;
  error?: string;
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
  role: 'user' | 'agent' | 'cross';
  content: string;
  thinking: string;
  tools: string;
  time: string;
  status: 'sent' | 'pending' | 'thinking' | 'executing' | 'completed' | 'error' | 'interrupted';
  moduleName: string;
  agentCmd: string;
  crossDirection?: 'sent' | 'received';
  crossModule?: string;
  crossPhase?: 'request' | 'response';
}

export interface MigrationData {
  moduleName: string;
  msgs: ChatMsg[];
}

export interface AgentStreamData {
  moduleName: string;
  // sessionId is sent by main.ts onSessionUpdate but was missing from preload/renderer callback types
  sessionId?: string;
  update: string;
  data: Record<string, unknown>;
  reply?: string;
  thinking?: string;
  tools?: string;
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
      command: string;
      args?: string[];
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

export interface ModuleAgentApi {
  selectDir(title: string): Promise<string | null>;

  scanProject(projectRoot: string): Promise<ScanResult>;

  generateModules(projectRoot: string): Promise<{ success: boolean; count: number; error?: string }>;

  getTree(): Promise<TreeNode | null>;

  startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }>;

  sendMessage(moduleName: string, text: string, cwd?: string): Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }>;

  cancelAgent(moduleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>;

  stopAgent(moduleName: string): Promise<{}>;

  isAgentRunning(moduleName: string): Promise<boolean>;

  getRunningAgents(): Promise<{ name: string; status: AgentStatus }[]>;

  onAgentStream(callback: (data: AgentStreamData) => void): () => void;

  onAgentStatus(callback: (data: AgentStatusData) => void): () => void;

  saveAgentConfig(
    projectRoot: string,
    cmd: string,
    args: string[],
    projectPath?: string,
  ): Promise<{ success: boolean }>;

  getAgentConfig(projectRoot: string): Promise<{
    command: string;
    args: string[];
    projectPath?: string;
  }>;

  migrateCheck(keys: string[]): Promise<{ needed: string[]; streamNeeded: boolean }>;

  migrateData(payload: MigrationData): Promise<void>;

  getContext(moduleName: string): Promise<ChatMsg[]>;

  clearContext(moduleName: string): Promise<void>;

  clearAllContexts(): Promise<void>;

  onCrossContext(callback: (data: CrossContextData) => void): () => void;

  // ── Role agent APIs ──
  getRoles(): Promise<RoleConfigData[]>;
  saveRole(role: RoleConfigData): Promise<{ success: boolean }>;
  deleteRole(name: string): Promise<{ success: boolean }>;

  startRoleAgent(roleName: string): Promise<{ sessionId?: string; error?: string }>;
  sendRoleMessage(roleName: string, text: string): Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }>;
  cancelRoleAgent(roleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>;
  stopRoleAgent(roleName: string): Promise<{}>;
  isRoleAgentRunning(roleName: string): Promise<boolean>;

  getRoleContext(roleName: string): Promise<ChatMsg[]>;
  clearRoleContext(roleName: string): Promise<void>;

  onRoleAgentStream(callback: (data: AgentStreamData) => void): () => void;
  onRoleAgentStatus(callback: (data: AgentStatusData) => void): () => void;

  // ── Knowledge APIs ──
  knowledgeList(): Promise<KnowledgeListItem[]>;
  knowledgeRead(filename: string): Promise<KnowledgeEntry | null>;
  knowledgeSave(entry: KnowledgeEntry): Promise<{ success: boolean }>;
  knowledgeCreate(name: string): Promise<KnowledgeEntry | { error: string }>;
  knowledgeDelete(filename: string): Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    moduleAgent: ModuleAgentApi;
  }
}
