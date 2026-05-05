export type AgentStatus = 'idle' | 'streaming' | 'error';

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
}

export interface AgentStreamData {
  moduleName: string;
  // sessionId is sent by main.ts onSessionUpdate but was missing from preload/renderer callback types
  sessionId?: string;
  update: string;
  data: Record<string, unknown>;
}

export interface CrossContextData {
  moduleName: string;
  crossModule: string;
  direction: 'sent' | 'received';
  phase: 'request' | 'response';
  content: string;
  time: string;
}

export interface CodeSource {
  type: 'git' | 'local';
  url?: string;
  branch?: string;
  path?: string;
}

export interface ModuleAgentApi {
  selectDir(title: string): Promise<string | null>;

  scanProject(projectRoot: string, workspaceRoot: string): Promise<ScanResult>;

  getTree(): Promise<TreeNode | null>;

  startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }>;

  sendMessage(moduleName: string, text: string): Promise<{ stopReason?: string; error?: string }>;

  cancelAgent(moduleName: string): Promise<{}>;

  stopAgent(moduleName: string): Promise<{}>;

  isAgentRunning(moduleName: string): Promise<boolean>;

  getRunningAgents(): Promise<{ name: string; status: AgentStatus }[]>;

  onAgentStream(callback: (data: AgentStreamData) => void): () => void;

  saveAgentConfig(
    projectRoot: string,
    cmd: string,
    args: string[],
    codeSource?: CodeSource,
    modulesPath?: string,
  ): Promise<{ success: boolean }>;

  getAgentConfig(projectRoot: string): Promise<{
    command: string;
    args: string[];
    codeSource?: CodeSource;
    modulesPath?: string;
  }>;

  onCrossContext(callback: (data: CrossContextData) => void): () => void;
}

declare global {
  interface Window {
    moduleAgent: ModuleAgentApi;
  }
}
