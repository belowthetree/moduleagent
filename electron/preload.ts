import { contextBridge, ipcRenderer } from 'electron';
import type { ModuleGraphNode } from '../src/types/module.js';

const api = {
  selectDir: (title: string) => ipcRenderer.invoke('dialog:selectDir', title) as Promise<string | null>,

  scanProject: (projectRoot: string, workspaceRoot: string) => ipcRenderer.invoke('project:scan', projectRoot, workspaceRoot) as Promise<{
    root: string;
    nodes: Record<string, ModuleGraphNode>;
    moduleCount: number;
    error?: string;
  }>,

  getTree: () => ipcRenderer.invoke('project:getTree') as Promise<Record<string, unknown> | null>,

  validateModules: (projectRoot: string) => ipcRenderer.invoke('project:validateModules', projectRoot) as Promise<{
    valid?: boolean;
    warnings?: string[];
    moduleCount?: number;
    error?: string;
  }>,
};

contextBridge.exposeInMainWorld('moduleAgent', api);

export type ModuleAgentApi = typeof api;
