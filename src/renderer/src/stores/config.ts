import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AgentStatus, CodeSource } from '../../../types/preload';

// localStorage keys — FROZEN contract, must match renderer.ts exactly
const LS_KEYS = {
  agentCmd: 'agentCmd',
  agentArgs: 'agentArgs',
  lastWorkspace: 'lastWorkspace',
  lastProject: 'lastProject',
  codeSourceType: 'codeSourceType',
  codeSourcePath: 'codeSourcePath',
  codeSourceUrl: 'codeSourceUrl',
  codeSourceBranch: 'codeSourceBranch',
} as const;

export const useConfigStore = defineStore('config', () => {
  // ── state ──
  const agentCmd = ref('opencode');
  const agentArgs = ref('acp');
  const workspacePath = ref('');
  const projectPath = ref('');
  const codeSourceType = ref<'local' | 'git'>('local');
  const codeSourcePath = ref('');
  const codeSourceUrl = ref('');
  const codeSourceBranch = ref('');

  // ── localStorage persistence ──
  function loadFromLocalStorage(): void {
    agentCmd.value = localStorage.getItem(LS_KEYS.agentCmd) || 'opencode';
    agentArgs.value = localStorage.getItem(LS_KEYS.agentArgs) || 'acp';
    workspacePath.value = localStorage.getItem(LS_KEYS.lastWorkspace) || '';
    projectPath.value = localStorage.getItem(LS_KEYS.lastProject) || '';
    codeSourceType.value = (localStorage.getItem(LS_KEYS.codeSourceType) as 'git' | 'local') || 'local';
    codeSourcePath.value = localStorage.getItem(LS_KEYS.codeSourcePath) || '';
    codeSourceUrl.value = localStorage.getItem(LS_KEYS.codeSourceUrl) || '';
    codeSourceBranch.value = localStorage.getItem(LS_KEYS.codeSourceBranch) || '';
  }

  function saveToLocalStorage(): void {
    localStorage.setItem(LS_KEYS.agentCmd, agentCmd.value);
    localStorage.setItem(LS_KEYS.agentArgs, agentArgs.value);
    localStorage.setItem(LS_KEYS.lastWorkspace, workspacePath.value);
    localStorage.setItem(LS_KEYS.lastProject, projectPath.value);
    localStorage.setItem(LS_KEYS.codeSourceType, codeSourceType.value);
    localStorage.setItem(LS_KEYS.codeSourcePath, codeSourcePath.value);
    localStorage.setItem(LS_KEYS.codeSourceUrl, codeSourceUrl.value);
    localStorage.setItem(LS_KEYS.codeSourceBranch, codeSourceBranch.value);
  }

  // ── project config persistence ──
  function buildCodeSource(): CodeSource {
    if (codeSourceType.value === 'local') {
      return { type: 'local', path: codeSourcePath.value };
    }
    return {
      type: 'git',
      url: codeSourceUrl.value,
      branch: codeSourceBranch.value || undefined,
    };
  }

  async function saveToProject(projectRoot: string): Promise<{ success: boolean }> {
    const args = agentArgs.value ? agentArgs.value.split(/\s+/).filter(Boolean) : [];
    const codeSource = buildCodeSource();
    return window.moduleAgent.saveAgentConfig(projectRoot, agentCmd.value, args, codeSource);
  }

  async function loadFromProject(projectRoot: string): Promise<void> {
    const config = await window.moduleAgent.getAgentConfig(projectRoot);
    agentCmd.value = config.command;
    agentArgs.value = (config.args || []).join(' ');
    if (config.codeSource) {
      codeSourceType.value = config.codeSource.type || 'local';
      codeSourcePath.value = config.codeSource.path || '';
      codeSourceUrl.value = config.codeSource.url || '';
      codeSourceBranch.value = config.codeSource.branch || '';
    }
    projectPath.value = projectRoot;
  }

  return {
    // state refs
    agentCmd,
    agentArgs,
    workspacePath,
    projectPath,
    codeSourceType,
    codeSourcePath,
    codeSourceUrl,
    codeSourceBranch,
    // functions
    loadFromLocalStorage,
    saveToLocalStorage,
    buildCodeSource,
    saveToProject,
    loadFromProject,
  };
});
