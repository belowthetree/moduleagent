import { contextBridge, ipcRenderer } from 'electron';
import type { ModuleAgentApi, AgentStreamData, AgentStatusData, CrossContextData, ScanResult, AgentStatus, ChatMsg, MigrationData, RoleConfigData, KnowledgeEntry, KnowledgeListItem } from '../types/preload.js';

const api: ModuleAgentApi = {
  selectDir: (title: string) => ipcRenderer.invoke('dialog:selectDir', title) as Promise<string | null>,

  scanProject: (projectRoot: string) =>
    ipcRenderer.invoke('project:scan', projectRoot) as Promise<ScanResult>,

  generateModules: (projectRoot: string) =>
    ipcRenderer.invoke('project:generateModules', projectRoot) as Promise<{ success: boolean; count: number; error?: string }>,

  getTree: () => ipcRenderer.invoke('project:getTree') as Promise<Record<string, unknown> | null>,

  // Agent API
  startAgent: (moduleName: string, cmd: string, args: string[], cwd: string) =>
    ipcRenderer.invoke('agent:start', moduleName, cmd, args, cwd) as Promise<{ sessionId?: string; error?: string }>,

  sendMessage: (moduleName: string, text: string, cwd?: string) =>
    ipcRenderer.invoke('agent:send', moduleName, text, cwd) as Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason: string }; error?: string }>,

  cancelAgent: (moduleName: string) => ipcRenderer.invoke('agent:cancel', moduleName) as Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>,

  stopAgent: (moduleName: string) => ipcRenderer.invoke('agent:stop', moduleName) as Promise<{}>,

  isAgentRunning: (moduleName: string) => ipcRenderer.invoke('agent:isRunning', moduleName) as Promise<boolean>,

  getRunningAgents: () => ipcRenderer.invoke('agent:getRunning') as Promise<{ name: string; status: AgentStatus }[]>,

  onAgentStream: (callback: (data: AgentStreamData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamData) => callback(data);
    ipcRenderer.on('agent:stream', handler);
    return () => ipcRenderer.removeListener('agent:stream', handler);
  },

  onAgentStatus: (callback: (data: AgentStatusData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStatusData) => callback(data);
    ipcRenderer.on('agent:status', handler);
    return () => ipcRenderer.removeListener('agent:status', handler);
  },

  // 配置 API
  saveAgentConfig: (projectRoot: string, cmd: string, args: string[], projectPath?: string, summarizationEnabled?: boolean) =>
    ipcRenderer.invoke('config:save', projectRoot, { command: cmd, args, projectPath, summarizationEnabled }) as Promise<{ success: boolean }>,

  getAgentConfig: (projectRoot: string) =>
    ipcRenderer.invoke('config:get', projectRoot) as Promise<{ command: string; args: string[]; projectPath?: string; summarizationEnabled?: boolean }>,

  // 迁移 API
  migrateCheck: (keys: string[]) => ipcRenderer.invoke('migrate:check', keys) as Promise<{ needed: string[]; streamNeeded: boolean }>,

  migrateData: (payload: MigrationData) => ipcRenderer.invoke('migrate:data', payload) as Promise<void>,

  // 上下文 API
  getContext: (moduleName: string) => ipcRenderer.invoke('context:get', moduleName) as Promise<ChatMsg[]>,

  clearContext: (moduleName: string) => ipcRenderer.invoke('context:clear', moduleName) as Promise<void>,

  clearAllContexts: () => ipcRenderer.invoke('context:clearAll') as Promise<void>,

  // 跨模块上下文事件
  onCrossContext: (callback: (data: CrossContextData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CrossContextData) => callback(data);
    ipcRenderer.on('agent:cross-context', handler);
    return () => ipcRenderer.removeListener('agent:cross-context', handler);
  },

  // ── 角色 Agent API ──
  getRoles: () => ipcRenderer.invoke('role:list') as Promise<RoleConfigData[]>,

  saveRole: (role: RoleConfigData) =>
    ipcRenderer.invoke('role:save', role) as Promise<{ success: boolean }>,

  deleteRole: (name: string) =>
    ipcRenderer.invoke('role:delete', name) as Promise<{ success: boolean }>,

  startRoleAgent: (roleName: string) =>
    ipcRenderer.invoke('role:start', roleName) as Promise<{ sessionId?: string; error?: string }>,

  sendRoleMessage: (roleName: string, text: string) =>
    ipcRenderer.invoke('role:send', roleName, text) as Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }>,

  cancelRoleAgent: (roleName: string) =>
    ipcRenderer.invoke('role:cancel', roleName) as Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>,

  stopRoleAgent: (roleName: string) =>
    ipcRenderer.invoke('role:stop', roleName) as Promise<{}>,

  isRoleAgentRunning: (roleName: string) =>
    ipcRenderer.invoke('role:isRunning', roleName) as Promise<boolean>,

  getRoleContext: (roleName: string) =>
    ipcRenderer.invoke('role:getContext', roleName) as Promise<ChatMsg[]>,

  clearRoleContext: (roleName: string) =>
    ipcRenderer.invoke('role:clearContext', roleName) as Promise<void>,

  onRoleAgentStream: (callback: (data: AgentStreamData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamData) => callback(data);
    ipcRenderer.on('role:stream', handler);
    return () => ipcRenderer.removeListener('role:stream', handler);
  },

  onRoleAgentStatus: (callback: (data: AgentStatusData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStatusData) => callback(data);
    ipcRenderer.on('role:status', handler);
    return () => ipcRenderer.removeListener('role:status', handler);
  },

  // ── 知识 API ──
  knowledgeList: () =>
    ipcRenderer.invoke('knowledge:list') as Promise<KnowledgeListItem[]>,

  knowledgeRead: (filename: string) =>
    ipcRenderer.invoke('knowledge:read', filename) as Promise<KnowledgeEntry | null>,

  knowledgeSave: (entry: KnowledgeEntry) =>
    ipcRenderer.invoke('knowledge:save', entry) as Promise<{ success: boolean }>,

  knowledgeCreate: (name: string) =>
    ipcRenderer.invoke('knowledge:create', name) as Promise<KnowledgeEntry | { error: string }>,

  knowledgeDelete: (filename: string) =>
    ipcRenderer.invoke('knowledge:delete', filename) as Promise<{ success: boolean }>,
};

contextBridge.exposeInMainWorld('moduleAgent', api);
export type { ModuleAgentApi };
