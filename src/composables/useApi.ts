/**
 * useApi — HTTP API client replacing window.moduleAgent IPC bridge.
 *
 * In Tauri mode: detects sidecar port from Tauri command.
 * In dev/Vite mode: uses default port 18888.
 *
 * Maintains the exact ModuleAgentApi interface so stores/components don't change.
 */

import { ref } from 'vue';
import type {
  ModuleAgentApi,
  AgentStreamData,
  AgentStatusData,
  CrossContextData,
  ScanResult,
  AgentStatus,
  ChatMsg,
  MigrationData,
  RoleConfigData,
  KnowledgeEntry,
  KnowledgeListItem,
  WorkflowListItem,
  WorkflowDetail,
  WorkflowStepResultItem,
  WorkflowStatus,
  TreeNode,
} from '../types/preload';

// ── Port detection ──
let apiBase = 'http://127.0.0.1:18888';

async function detectPort(): Promise<void> {
  try {
    // Try Tauri invoke first
    if ((window as any).__TAURI__) {
      const { invoke } = (window as any).__TAURI__.core;
      const port = await invoke('get_sidecar_port');
      apiBase = `http://127.0.0.1:${port}`;
    }
  } catch {
    // Fall back to default port for dev mode
  }
}

// Call detectPort at module init
detectPort();

// ── SSE connection ──
let sseSource: EventSource | null = null;
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;

interface SSECallbacks {
  onAgentStream: ((data: AgentStreamData) => void)[];
  onAgentStatus: ((data: AgentStatusData) => void)[];
  onCrossContext: ((data: CrossContextData) => void)[];
  onRoleStream: ((data: AgentStreamData) => void)[];
  onRoleStatus: ((data: AgentStatusData) => void)[];
}

const sseCallbacks: SSECallbacks = {
  onAgentStream: [],
  onAgentStatus: [],
  onCrossContext: [],
  onRoleStream: [],
  onRoleStatus: [],
};

function connectSSE(): void {
  if (sseSource) return;

  const url = `${apiBase}/api/stream`;
  sseSource = new EventSource(url);

  sseSource.onopen = () => {
    console.log('[SSE] Connected to sidecar');
  };

  sseSource.addEventListener('agent-stream', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      for (const cb of sseCallbacks.onAgentStream) cb(data);
    } catch { /* ignore parse errors */ }
  });

  sseSource.addEventListener('agent-status', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      for (const cb of sseCallbacks.onAgentStatus) cb(data);
    } catch { /* ignore */ }
  });

  sseSource.addEventListener('cross-context', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      for (const cb of sseCallbacks.onCrossContext) cb(data);
    } catch { /* ignore */ }
  });

  sseSource.addEventListener('role-stream', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      for (const cb of sseCallbacks.onRoleStream) cb(data);
    } catch { /* ignore */ }
  });

  sseSource.addEventListener('role-status', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      for (const cb of sseCallbacks.onRoleStatus) cb(data);
    } catch { /* ignore */ }
  });

  sseSource.onerror = () => {
    console.warn('[SSE] Connection lost, reconnecting...');
    sseSource?.close();
    sseSource = null;
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    sseReconnectTimer = setTimeout(connectSSE, 2000);
  };
}

function ensureSSE(): void {
  if (!sseSource) connectSSE();
}

// ── HTTP helpers ──
async function get(path: string): Promise<any> {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function post(path: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function del(path: string): Promise<any> {
  const res = await fetch(`${apiBase}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── ModuleAgentApi implementation ──

export function createModuleAgentApi(): ModuleAgentApi {
  ensureSSE();

  return {
    // ── Dialog (via Tauri or fallback) ──
    async selectDir(title: string): Promise<string | null> {
      try {
        if ((window as any).__TAURI__) {
          const { invoke } = (window as any).__TAURI__.core;
          return await invoke('select_dir', { title });
        }
      } catch { /* fall through */ }
      // Fallback for dev: use a simple prompt
      return prompt('Enter project directory path:') || null;
    },

    // ── Project ──
    async scanProject(projectRoot: string): Promise<ScanResult> {
      return post('/api/project/scan', { projectRoot });
    },

    async generateModules(projectRoot: string): Promise<{ success: boolean; count: number; error?: string }> {
      return post('/api/project/generate', { projectRoot });
    },

    async getTree(): Promise<TreeNode | null> {
      return get('/api/project/tree');
    },

    // ── Agent ──
    async startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }> {
      return post('/api/agent/start', { moduleName, cmd, args, cwd });
    },

    async sendMessage(moduleName: string, text: string, cwd?: string): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: any[]; stopReason?: string }; error?: string }> {
      return post('/api/agent/send', { moduleName, text, cwd });
    },

    async cancelAgent(moduleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }> {
      return post('/api/agent/cancel', { moduleName });
    },

    async stopAgent(moduleName: string): Promise<{}> {
      return post('/api/agent/stop', { moduleName });
    },

    async isAgentRunning(moduleName: string): Promise<boolean> {
      const agents = await get('/api/agent/running');
      return agents.some((a: any) => a.name === moduleName);
    },

    async getRunningAgents(): Promise<{ name: string; status: AgentStatus }[]> {
      return get('/api/agent/running');
    },

    onAgentStream(callback: (data: AgentStreamData) => void): () => void {
      sseCallbacks.onAgentStream.push(callback);
      return () => {
        const idx = sseCallbacks.onAgentStream.indexOf(callback);
        if (idx >= 0) sseCallbacks.onAgentStream.splice(idx, 1);
      };
    },

    onAgentStatus(callback: (data: AgentStatusData) => void): () => void {
      sseCallbacks.onAgentStatus.push(callback);
      return () => {
        const idx = sseCallbacks.onAgentStatus.indexOf(callback);
        if (idx >= 0) sseCallbacks.onAgentStatus.splice(idx, 1);
      };
    },

    // ── Config ──
    async saveAgentConfig(projectRoot: string, cmd: string, args: string[], projectPath?: string, summarizationEnabled?: boolean): Promise<{ success: boolean }> {
      return post('/api/config/save', { projectRoot, command: cmd, args, projectPath, summarizationEnabled });
    },

    async getAgentConfig(projectRoot: string): Promise<{ command: string; args: string[]; projectPath?: string; summarizationEnabled?: boolean }> {
      return get(`/api/config/get?projectRoot=${encodeURIComponent(projectRoot)}`);
    },

    // ── Migration ──
    async migrateCheck(keys: string[]): Promise<{ needed: string[]; streamNeeded: boolean }> {
      return post('/api/migrate/check', { keys });
    },

    async migrateData(payload: MigrationData): Promise<void> {
      await post('/api/migrate/data', payload as unknown as Record<string, unknown>);
    },

    // ── Context ──
    async getContext(moduleName: string): Promise<ChatMsg[]> {
      return get(`/api/context/${encodeURIComponent(moduleName)}`);
    },

    async clearContext(moduleName: string): Promise<void> {
      await del(`/api/context/${encodeURIComponent(moduleName)}`);
    },

    async clearAllContexts(): Promise<void> {
      await del('/api/context');
    },

    // ── Cross context ──
    onCrossContext(callback: (data: CrossContextData) => void): () => void {
      sseCallbacks.onCrossContext.push(callback);
      return () => {
        const idx = sseCallbacks.onCrossContext.indexOf(callback);
        if (idx >= 0) sseCallbacks.onCrossContext.splice(idx, 1);
      };
    },

    // ── Role Agent ──
    async getRoles(): Promise<RoleConfigData[]> {
      return get('/api/roles');
    },

    async saveRole(role: RoleConfigData): Promise<{ success: boolean }> {
      return post('/api/roles', role as unknown as Record<string, unknown>);
    },

    async deleteRole(name: string): Promise<{ success: boolean }> {
      return del(`/api/roles/${encodeURIComponent(name)}`);
    },

    async startRoleAgent(roleName: string): Promise<{ sessionId?: string; error?: string }> {
      return post(`/api/roles/${encodeURIComponent(roleName)}/start`);
    },

    async sendRoleMessage(roleName: string, text: string): Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }> {
      return post(`/api/roles/${encodeURIComponent(roleName)}/send`, { text });
    },

    async cancelRoleAgent(roleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }> {
      return post(`/api/roles/${encodeURIComponent(roleName)}/cancel`);
    },

    async stopRoleAgent(roleName: string): Promise<{}> {
      return post(`/api/roles/${encodeURIComponent(roleName)}/stop`);
    },

    async isRoleAgentRunning(roleName: string): Promise<boolean> {
      // We use the status SSE to track this
      return false; // Simplified
    },

    async getRoleContext(roleName: string): Promise<ChatMsg[]> {
      return get(`/api/roles/${encodeURIComponent(roleName)}/context`);
    },

    async clearRoleContext(roleName: string): Promise<void> {
      await del(`/api/roles/${encodeURIComponent(roleName)}/context`);
    },

    onRoleAgentStream(callback: (data: AgentStreamData) => void): () => void {
      sseCallbacks.onRoleStream.push(callback);
      return () => {
        const idx = sseCallbacks.onRoleStream.indexOf(callback);
        if (idx >= 0) sseCallbacks.onRoleStream.splice(idx, 1);
      };
    },

    onRoleAgentStatus(callback: (data: AgentStatusData) => void): () => void {
      sseCallbacks.onRoleStatus.push(callback);
      return () => {
        const idx = sseCallbacks.onRoleStatus.indexOf(callback);
        if (idx >= 0) sseCallbacks.onRoleStatus.splice(idx, 1);
      };
    },

    // ── Knowledge ──
    async knowledgeList(): Promise<KnowledgeListItem[]> {
      return get('/api/knowledge');
    },

    async knowledgeRead(filename: string): Promise<KnowledgeEntry | null> {
      return get(`/api/knowledge/${encodeURIComponent(filename)}`);
    },

    async knowledgeSave(entry: KnowledgeEntry): Promise<{ success: boolean }> {
      return post('/api/knowledge', entry as unknown as Record<string, unknown>);
    },

    async knowledgeCreate(name: string): Promise<KnowledgeEntry | { error: string }> {
      return post('/api/knowledge', { create: true, name });
    },

    async knowledgeDelete(filename: string): Promise<{ success: boolean }> {
      return del(`/api/knowledge/${encodeURIComponent(filename)}`);
    },

    // ── Workflow ──
    async workflowList(): Promise<WorkflowListItem[]> {
      return get('/api/workflows');
    },

    async workflowLoad(name: string): Promise<WorkflowDetail | { error: string }> {
      return get(`/api/workflows/${encodeURIComponent(name)}`);
    },

    async workflowCreate(name: string): Promise<{ success: boolean; error?: string }> {
      return post('/api/workflows', { name });
    },

    async workflowDelete(name: string): Promise<{ success: boolean }> {
      return del(`/api/workflows/${encodeURIComponent(name)}`);
    },

    async workflowStepSave(wfName: string, stepName: string, content: string): Promise<{ success: boolean }> {
      return post(`/api/workflows/${encodeURIComponent(wfName)}/steps`, { stepName, content });
    },

    async workflowStepDelete(wfName: string, stepName: string): Promise<{ success: boolean }> {
      return del(`/api/workflows/${encodeURIComponent(wfName)}/steps/${encodeURIComponent(stepName)}`);
    },

    async workflowStepAdd(wfName: string): Promise<{ success: boolean; stepName?: string; error?: string }> {
      return post(`/api/workflows/${encodeURIComponent(wfName)}/steps/add`);
    },

    async workflowExecute(name: string, userInput?: string): Promise<{ success: boolean; results?: WorkflowStepResultItem[]; error?: string }> {
      return post(`/api/workflows/${encodeURIComponent(name)}/execute`, { userInput });
    },

    async workflowCancel(name: string): Promise<void> {
      await post(`/api/workflows/${encodeURIComponent(name)}/cancel`);
    },

    async workflowStatus(name: string): Promise<WorkflowStatus | null> {
      return get(`/api/workflows/${encodeURIComponent(name)}/status`);
    },
  };
}

// Singleton
let _api: ModuleAgentApi | null = null;

export function useModuleAgent(): ModuleAgentApi {
  if (!_api) {
    _api = createModuleAgentApi();
  }
  return _api;
}

// For direct access (replaces window.moduleAgent)
export function getApi(): ModuleAgentApi {
  return useModuleAgent();
}
