import { contextBridge, ipcRenderer } from 'electron';
import type { ModuleAgentApi, AgentStreamData, AgentStatusData, CrossContextData, ScanResult, AgentStatus, ChatMsg, MigrationData } from '../types/preload.js';

const api: ModuleAgentApi = {
  selectDir: (title: string) => ipcRenderer.invoke('dialog:selectDir', title) as Promise<string | null>,

  scanProject: (projectRoot: string) =>
    ipcRenderer.invoke('project:scan', projectRoot) as Promise<ScanResult>,

  getTree: () => ipcRenderer.invoke('project:getTree') as Promise<Record<string, unknown> | null>,

  // Agent APIs
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

  // Config APIs
  saveAgentConfig: (projectRoot: string, cmd: string, args: string[], projectPath?: string) =>
    ipcRenderer.invoke('config:save', projectRoot, { command: cmd, args, projectPath }) as Promise<{ success: boolean }>,

  getAgentConfig: (projectRoot: string) =>
    ipcRenderer.invoke('config:get', projectRoot) as Promise<{ command: string; args: string[]; projectPath?: string }>,

  // Migration APIs
  migrateCheck: (keys: string[]) => ipcRenderer.invoke('migrate:check', keys) as Promise<{ needed: string[]; streamNeeded: boolean }>,

  migrateData: (payload: MigrationData) => ipcRenderer.invoke('migrate:data', payload) as Promise<void>,

  // Context APIs
  getContext: (moduleName: string) => ipcRenderer.invoke('context:get', moduleName) as Promise<ChatMsg[]>,

  clearContext: (moduleName: string) => ipcRenderer.invoke('context:clear', moduleName) as Promise<void>,

  clearAllContexts: () => ipcRenderer.invoke('context:clearAll') as Promise<void>,

  // Cross-module context events
  onCrossContext: (callback: (data: CrossContextData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CrossContextData) => callback(data);
    ipcRenderer.on('agent:cross-context', handler);
    return () => ipcRenderer.removeListener('agent:cross-context', handler);
  },
};

contextBridge.exposeInMainWorld('moduleAgent', api);
export type { ModuleAgentApi };
