// ---------------------------------------------------------------------------
// preload/index.ts — Electron preload 脚本
// 通过 contextBridge 向渲染进程暴露 window.moduleAgent API，桥接 IPC 调用
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from '../protocol/IpcChannels.js';
import type { ModuleAgentApi, AgentStreamData, AgentStatusData, CrossContextData, ScanResult, AgentStatus, ChatMsg, MigrationData, RoleConfigData, KnowledgeEntry, KnowledgeListItem, WorkflowListItem, WorkflowDetail, WorkflowStepResultItem, WorkflowStatus, DiffSummary, WorkspaceDiffReadyData } from '../types/shared.js';

const api: ModuleAgentApi = {
  selectDir: (title: string) => ipcRenderer.invoke(IpcChannel.Dialog.SelectDir, title) as Promise<string | null>,

  scanProject: (projectRoot: string) =>
    ipcRenderer.invoke(IpcChannel.Project.Scan, projectRoot) as Promise<ScanResult>,

  generateModules: (projectRoot: string) =>
    ipcRenderer.invoke(IpcChannel.Project.GenerateModules, projectRoot) as Promise<{ success: boolean; count: number; error?: string }>,

  getTree: () => ipcRenderer.invoke(IpcChannel.Project.GetTree) as Promise<Record<string, unknown> | null>,

  // Agent API
  startAgent: (moduleName: string, cmd: string, args: string[], cwd: string) =>
    ipcRenderer.invoke(IpcChannel.Agent.Start, moduleName, cmd, args, cwd) as Promise<{ sessionId?: string; error?: string }>,

  sendMessage: (moduleName: string, text: string, cwd?: string) =>
    ipcRenderer.invoke(IpcChannel.Agent.Send, moduleName, text, cwd) as Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason: string }; error?: string }>,

  cancelAgent: (moduleName: string) => ipcRenderer.invoke(IpcChannel.Agent.Cancel, moduleName) as Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>,

  stopAgent: (moduleName: string) => ipcRenderer.invoke(IpcChannel.Agent.Stop, moduleName) as Promise<{}>,

  isAgentRunning: (moduleName: string) => ipcRenderer.invoke(IpcChannel.Agent.IsRunning, moduleName) as Promise<boolean>,

  getRunningAgents: () => ipcRenderer.invoke(IpcChannel.Agent.GetRunning) as Promise<{ name: string; status: AgentStatus }[]>,

  onAgentStream: (callback: (data: AgentStreamData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.AgentStream, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.AgentStream, handler);
  },

  onAgentStatus: (callback: (data: AgentStatusData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStatusData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.AgentStatus, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.AgentStatus, handler);
  },

  // 配置 API
  saveAgentConfig: (projectRoot: string, provider: string, apiKey: string, baseUrl: string, model: string, projectPath?: string, summarizationEnabled?: boolean) =>
    ipcRenderer.invoke(IpcChannel.Config.Save, projectRoot, { provider, apiKey, baseUrl, model, projectPath, summarizationEnabled }) as Promise<{ success: boolean }>,

  getAgentConfig: (projectRoot: string) =>
    ipcRenderer.invoke(IpcChannel.Config.Get, projectRoot) as Promise<{ provider?: string; apiKey?: string; baseUrl?: string; model?: string; projectPath?: string; summarizationEnabled?: boolean }>,

  // 迁移 API
  migrateCheck: (keys: string[]) => ipcRenderer.invoke(IpcChannel.Migrate.Check, keys) as Promise<{ needed: string[]; streamNeeded: boolean }>,

  migrateData: (payload: MigrationData) => ipcRenderer.invoke(IpcChannel.Migrate.Data, payload) as Promise<void>,

  // 上下文 API
  getContext: (moduleName: string) => ipcRenderer.invoke(IpcChannel.Context.Get, moduleName) as Promise<ChatMsg[]>,

  clearContext: (moduleName: string) => ipcRenderer.invoke(IpcChannel.Context.Clear, moduleName) as Promise<void>,

  clearAllContexts: () => ipcRenderer.invoke(IpcChannel.Context.ClearAll) as Promise<void>,

  // 跨模块上下文事件
  onCrossContext: (callback: (data: CrossContextData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CrossContextData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.CrossContext, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.CrossContext, handler);
  },

  // ── 角色 Agent API ──
  getRoles: () => ipcRenderer.invoke(IpcChannel.Role.List) as Promise<RoleConfigData[]>,

  saveRole: (role: RoleConfigData) =>
    ipcRenderer.invoke(IpcChannel.Role.Save, role) as Promise<{ success: boolean }>,

  deleteRole: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Role.Delete, name) as Promise<{ success: boolean }>,

  startRoleAgent: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.Start, roleName) as Promise<{ sessionId?: string; error?: string }>,

  sendRoleMessage: (roleName: string, text: string) =>
    ipcRenderer.invoke(IpcChannel.Role.Send, roleName, text) as Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason?: string }; error?: string }>,

  cancelRoleAgent: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.Cancel, roleName) as Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }>,

  stopRoleAgent: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.Stop, roleName) as Promise<{}>,

  isRoleAgentRunning: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.IsRunning, roleName) as Promise<boolean>,

  getRoleContext: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.GetContext, roleName) as Promise<ChatMsg[]>,

  clearRoleContext: (roleName: string) =>
    ipcRenderer.invoke(IpcChannel.Role.ClearContext, roleName) as Promise<void>,

  onRoleAgentStream: (callback: (data: AgentStreamData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.RoleStream, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.RoleStream, handler);
  },

  onRoleAgentStatus: (callback: (data: AgentStatusData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStatusData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.RoleStatus, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.RoleStatus, handler);
  },

  // ── 知识 API ──
  knowledgeList: () =>
    ipcRenderer.invoke(IpcChannel.Knowledge.List) as Promise<KnowledgeListItem[]>,

  knowledgeRead: (filename: string) =>
    ipcRenderer.invoke(IpcChannel.Knowledge.Read, filename) as Promise<KnowledgeEntry | null>,

  knowledgeSave: (entry: KnowledgeEntry) =>
    ipcRenderer.invoke(IpcChannel.Knowledge.Save, entry) as Promise<{ success: boolean }>,

  knowledgeCreate: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Knowledge.Create, name) as Promise<KnowledgeEntry | { error: string }>,

  knowledgeDelete: (filename: string) =>
    ipcRenderer.invoke(IpcChannel.Knowledge.Delete, filename) as Promise<{ success: boolean }>,

  // ── 工作流 API ──
  workflowList: () =>
    ipcRenderer.invoke(IpcChannel.Workflow.List) as Promise<WorkflowListItem[]>,

  workflowLoad: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Load, name) as Promise<WorkflowDetail | { error: string }>,

  workflowCreate: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Create, name) as Promise<{ success: boolean; error?: string }>,

  workflowDelete: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Delete, name) as Promise<{ success: boolean }>,

  workflowStepSave: (wfName: string, stepName: string, content: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.StepSave, wfName, stepName, content) as Promise<{ success: boolean }>,

  workflowStepDelete: (wfName: string, stepName: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.StepDelete, wfName, stepName) as Promise<{ success: boolean }>,

  workflowStepAdd: (wfName: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.StepAdd, wfName) as Promise<{ success: boolean; stepName?: string; error?: string }>,

  workflowExecute: (name: string, userInput?: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Execute, name, userInput) as Promise<{ success: boolean; results?: WorkflowStepResultItem[]; error?: string }>,

  workflowCancel: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Cancel, name) as Promise<void>,

  workflowStatus: (name: string) =>
    ipcRenderer.invoke(IpcChannel.Workflow.Status, name) as Promise<WorkflowStatus | null>,

  // ── 工作区 Diff API ──
  workspaceDiff: (moduleName: string) =>
    ipcRenderer.invoke(IpcChannel.WorkspaceDiff.Diff, moduleName) as Promise<DiffSummary | { error: string }>,

  workspaceDiffFile: (moduleName: string, filePath: string) =>
    ipcRenderer.invoke(IpcChannel.WorkspaceDiff.DiffFile, moduleName, filePath) as Promise<{ hunks: string } | { error: string }>,

  workspaceApply: (moduleName: string, files?: string[]) =>
    ipcRenderer.invoke(IpcChannel.WorkspaceDiff.Apply, moduleName, files) as Promise<{ applied: number; errors: string[] }>,

  workspaceDiscard: (moduleName: string) =>
    ipcRenderer.invoke(IpcChannel.WorkspaceDiff.Discard, moduleName) as Promise<{ success: boolean }>,

  onWorkspaceDiffReady: (callback: (data: WorkspaceDiffReadyData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: WorkspaceDiffReadyData) => callback(data);
    ipcRenderer.on(IpcChannel.Push.WorkspaceDiffReady, handler);
    return () => ipcRenderer.removeListener(IpcChannel.Push.WorkspaceDiffReady, handler);
  },
};

contextBridge.exposeInMainWorld('moduleAgent', api);
export type { ModuleAgentApi };
