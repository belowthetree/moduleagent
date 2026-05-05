import { contextBridge, ipcRenderer } from 'electron';
import type { ModuleAgentApi, AgentStreamData, CrossContextData, ScanResult, AgentStatus } from '../types/preload.js';

const api: ModuleAgentApi = {
  selectDir: (title: string) => ipcRenderer.invoke('dialog:selectDir', title) as Promise<string | null>,

  scanProject: (projectRoot: string, workspaceRoot: string) =>
    ipcRenderer.invoke('project:scan', projectRoot, workspaceRoot) as Promise<ScanResult>,

  getTree: () => ipcRenderer.invoke('project:getTree') as Promise<Record<string, unknown> | null>,

  // Agent APIs
  startAgent: (moduleName: string, cmd: string, args: string[], cwd: string) =>
    ipcRenderer.invoke('agent:start', moduleName, cmd, args, cwd) as Promise<{ sessionId?: string; error?: string }>,

  sendMessage: (moduleName: string, text: string) =>
    ipcRenderer.invoke('agent:send', moduleName, text) as Promise<{ stopReason?: string; error?: string }>,

  cancelAgent: (moduleName: string) => ipcRenderer.invoke('agent:cancel', moduleName) as Promise<{}>,

  stopAgent: (moduleName: string) => ipcRenderer.invoke('agent:stop', moduleName) as Promise<{}>,

  isAgentRunning: (moduleName: string) => ipcRenderer.invoke('agent:isRunning', moduleName) as Promise<boolean>,

  getRunningAgents: () => ipcRenderer.invoke('agent:getRunning') as Promise<{ name: string; status: AgentStatus }[]>,

  onAgentStream: (callback: (data: AgentStreamData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamData) => callback(data);
    ipcRenderer.on('agent:stream', handler);
    return () => ipcRenderer.removeListener('agent:stream', handler);
  },

  // Config APIs
  saveAgentConfig: (projectRoot: string, cmd: string, args: string[], codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string }, modulesPath?: string) =>
    ipcRenderer.invoke('config:save', projectRoot, { command: cmd, args, codeSource, modulesPath }) as Promise<{ success: boolean }>,

  getAgentConfig: (projectRoot: string) =>
    ipcRenderer.invoke('config:get', projectRoot) as Promise<{ command: string; args: string[]; codeSource?: { type: 'git' | 'local'; url?: string; branch?: string; path?: string }; modulesPath?: string }>,

  // Cross-module context events
  onCrossContext: (callback: (data: CrossContextData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CrossContextData) => callback(data);
    ipcRenderer.on('agent:cross-context', handler);
    return () => ipcRenderer.removeListener('agent:cross-context', handler);
  },
};

contextBridge.exposeInMainWorld('moduleAgent', api);
export type { ModuleAgentApi };
