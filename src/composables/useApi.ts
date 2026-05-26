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

let tauriInvoke: any = null;
let tauriListen: any = null;

function getTauri() {
  if (!tauriInvoke && (window as any).__TAURI__) {
    const core = (window as any).__TAURI__.core;
    tauriInvoke = core.invoke;
    tauriListen = core.listen;
  }
  return { invoke: tauriInvoke, listen: tauriListen };
}

const sseCallbacks = {
  onAgentStream: [] as ((data: AgentStreamData) => void)[],
  onAgentStatus: [] as ((data: AgentStatusData) => void)[],
  onCrossContext: [] as ((data: CrossContextData) => void)[],
  onRoleStream: [] as ((data: AgentStreamData) => void)[],
  onRoleStatus: [] as ((data: AgentStatusData) => void)[],
};

let unlisten: (() => void) | null = null;

async function setupStreamListener() {
  const { listen } = getTauri();
  if (!listen || unlisten) return;
  try {
    unlisten = await listen('stream', (event: any) => {
      const { type: eventType, data } = event.payload;
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      switch (eventType) {
        case 'agent-stream':
          sseCallbacks.onAgentStream.forEach(cb => cb(parsed));
          break;
        case 'agent-status':
          sseCallbacks.onAgentStatus.forEach(cb => cb(parsed));
          break;
        case 'cross-context':
          sseCallbacks.onCrossContext.forEach(cb => cb(parsed));
          break;
        case 'role-stream':
          sseCallbacks.onRoleStream.forEach(cb => cb(parsed));
          break;
        case 'role-status':
          sseCallbacks.onRoleStatus.forEach(cb => cb(parsed));
          break;
        case 'chunk-reply':
        case 'chunk-thinking':
        case 'chunk-tool_call':
          sseCallbacks.onAgentStream.forEach(cb => cb(parsed as AgentStreamData));
          break;
      }
    });
  } catch {}
}

setupStreamListener();

async function invokeCmd<T = any>(cmd: string, args?: any): Promise<T> {
  const { invoke } = getTauri();
  if (invoke) return invoke(cmd, args);
  throw new Error('Tauri not available');
}

export function createModuleAgentApi(): ModuleAgentApi {
  return {
    async selectDir(title: string): Promise<string | null> {
      try {
        const { invoke } = getTauri();
        if (invoke) return await invoke('select_dir', { title });
      } catch {}
      return prompt('Enter project directory path:') || null;
    },

    async scanProject(projectRoot: string): Promise<ScanResult> {
      return invokeCmd<ScanResult>('project_scan', { body: { projectPath: projectRoot } });
    },

    async generateModules(projectRoot: string): Promise<{ success: boolean; count: number; error?: string }> {
      return invokeCmd('project_generate', { body: { projectRoot } });
    },

    async getTree(): Promise<TreeNode | null> {
      return invokeCmd<TreeNode | null>('project_tree');
    },

    async startAgent(moduleName: string, cmd: string, args: string[], cwd: string): Promise<{ sessionId?: string; error?: string }> {
      return invokeCmd('agent_start', { body: { name: moduleName, command: cmd, args, cwd } });
    },

    async sendMessage(moduleName: string, text: string, cwd?: string): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: any[]; stopReason?: string }; error?: string }> {
      return invokeCmd('agent_send', { body: { name: moduleName, text, cwd } });
    },

    async cancelAgent(moduleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }> {
      return invokeCmd('agent_cancel', { body: { name: moduleName } });
    },

    async stopAgent(moduleName: string): Promise<{}> {
      return invokeCmd('agent_stop', { body: { name: moduleName } });
    },

    async isAgentRunning(moduleName: string): Promise<boolean> {
      const agents = await invokeCmd<any[]>('agent_running');
      return agents.some((a: any) => a.name === moduleName);
    },

    async getRunningAgents(): Promise<{ name: string; status: AgentStatus }[]> {
      return invokeCmd<{ name: string; status: AgentStatus }[]>('agent_running');
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

    async saveAgentConfig(projectRoot: string, cmd: string, args: string[], projectPath?: string, summarizationEnabled?: boolean): Promise<{ success: boolean }> {
      return invokeCmd('config_save', { body: { projectRoot, command: cmd, args, projectPath, summarizationEnabled } });
    },

    async getAgentConfig(projectRoot: string): Promise<{ command: string; args: string[]; projectPath?: string; summarizationEnabled?: boolean }> {
      return invokeCmd('config_get', { body: { projectRoot } });
    },

    async migrateCheck(keys: string[]): Promise<{ needed: string[]; streamNeeded: boolean }> {
      return invokeCmd('migrate_check', { body: { keys } });
    },

    async migrateData(payload: MigrationData): Promise<void> {
      await invokeCmd('migrate_data', { body: payload });
    },

    async getContext(moduleName: string): Promise<ChatMsg[]> {
      return invokeCmd<ChatMsg[]>('context_get', { name: moduleName });
    },

    async clearContext(moduleName: string): Promise<void> {
      await invokeCmd('context_clear', { name: moduleName });
    },

    async clearAllContexts(): Promise<void> {
      await invokeCmd('context_clear_all');
    },

    onCrossContext(callback: (data: CrossContextData) => void): () => void {
      sseCallbacks.onCrossContext.push(callback);
      return () => {
        const idx = sseCallbacks.onCrossContext.indexOf(callback);
        if (idx >= 0) sseCallbacks.onCrossContext.splice(idx, 1);
      };
    },

    async getRoles(): Promise<RoleConfigData[]> {
      return invokeCmd<RoleConfigData[]>('roles_list');
    },

    async saveRole(role: RoleConfigData): Promise<{ success: boolean }> {
      return invokeCmd('roles_save', { body: role });
    },

    async deleteRole(name: string): Promise<{ success: boolean }> {
      return invokeCmd('roles_delete', { name });
    },

    async startRoleAgent(roleName: string): Promise<{ sessionId?: string; error?: string }> {
      return invokeCmd('role_start', { name: roleName });
    },

    async sendRoleMessage(roleName: string, text: string): Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }> {
      return invokeCmd('role_send', { name: roleName, body: { text } });
    },

    async cancelRoleAgent(roleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }> {
      return invokeCmd('role_cancel', { name: roleName });
    },

    async stopRoleAgent(roleName: string): Promise<{}> {
      return invokeCmd('role_stop', { name: roleName });
    },

    async isRoleAgentRunning(roleName: string): Promise<boolean> {
      return false;
    },

    async getRoleContext(roleName: string): Promise<ChatMsg[]> {
      return invokeCmd<ChatMsg[]>('role_context_get', { name: roleName });
    },

    async clearRoleContext(roleName: string): Promise<void> {
      await invokeCmd('role_context_clear', { name: roleName });
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

    async knowledgeList(): Promise<KnowledgeListItem[]> {
      return invokeCmd<KnowledgeListItem[]>('knowledge_list');
    },

    async knowledgeRead(filename: string): Promise<KnowledgeEntry | null> {
      return invokeCmd<KnowledgeEntry | null>('knowledge_read', { filename });
    },

    async knowledgeSave(entry: KnowledgeEntry): Promise<{ success: boolean }> {
      return invokeCmd('knowledge_save', { body: entry });
    },

    async knowledgeCreate(name: string): Promise<KnowledgeEntry | { error: string }> {
      return invokeCmd('knowledge_save', { body: { create: true, name } });
    },

    async knowledgeDelete(filename: string): Promise<{ success: boolean }> {
      return invokeCmd('knowledge_delete', { filename });
    },

    async workflowList(): Promise<WorkflowListItem[]> {
      return invokeCmd<WorkflowListItem[]>('workflow_list');
    },

    async workflowLoad(name: string): Promise<WorkflowDetail | { error: string }> {
      return invokeCmd<WorkflowDetail | { error: string }>('workflow_load', { name });
    },

    async workflowCreate(name: string): Promise<{ success: boolean; error?: string }> {
      return invokeCmd('workflow_create', { body: { name } });
    },

    async workflowDelete(name: string): Promise<{ success: boolean }> {
      return invokeCmd('workflow_delete', { name });
    },

    async workflowStepSave(wfName: string, stepName: string, content: string): Promise<{ success: boolean }> {
      return invokeCmd('workflow_step_save', { name: wfName, body: { content } });
    },

    async workflowStepDelete(wfName: string, stepName: string): Promise<{ success: boolean }> {
      return invokeCmd('workflow_step_delete', { name: wfName, step: stepName });
    },

    async workflowStepAdd(wfName: string): Promise<{ success: boolean; stepName?: string; error?: string }> {
      return invokeCmd('workflow_step_add', { name: wfName, body: {} });
    },

    async workflowExecute(name: string, userInput?: string): Promise<{ success: boolean; results?: WorkflowStepResultItem[]; error?: string }> {
      return invokeCmd('workflow_execute', { name, body: { input: userInput } });
    },

    async workflowCancel(name: string): Promise<void> {
      await invokeCmd('workflow_cancel', { name });
    },

    async workflowStatus(name: string): Promise<WorkflowStatus | null> {
      return invokeCmd<WorkflowStatus | null>('workflow_status', { name });
    },
  };
}

let _api: ModuleAgentApi | null = null;

export function useModuleAgent(): ModuleAgentApi {
  if (!_api) _api = createModuleAgentApi();
  return _api;
}

export function getApi(): ModuleAgentApi {
  return useModuleAgent();
}