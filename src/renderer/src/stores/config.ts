import { defineStore } from 'pinia';
import { ref } from 'vue';

// localStorage keys — FROZEN contract, must match renderer.ts exactly
const LS_KEYS = {
  agentCmd: 'agentCmd',
  agentArgs: 'agentArgs',
  lastProject: 'lastProject',
  autoDocUpdate: 'autoDocUpdate',
} as const;

export const useConfigStore = defineStore('config', () => {
  // ── state ──
  const agentCmd = ref('opencode');
  const agentArgs = ref('acp');
  const projectPath = ref('');
  const autoDocUpdate = ref(true);

  // ── localStorage persistence ──
  function loadFromLocalStorage(): void {
    agentCmd.value = localStorage.getItem(LS_KEYS.agentCmd) || 'opencode';
    agentArgs.value = localStorage.getItem(LS_KEYS.agentArgs) || 'acp';
    autoDocUpdate.value = localStorage.getItem(LS_KEYS.autoDocUpdate) !== 'false';

    // Migration: old `lastWorkspace` key → `lastProject`
    const legacyWorkspace = localStorage.getItem('lastWorkspace');
    if (legacyWorkspace) {
      localStorage.setItem(LS_KEYS.lastProject, legacyWorkspace);
      localStorage.removeItem('lastWorkspace');
    }

    projectPath.value = localStorage.getItem(LS_KEYS.lastProject) || '';

    // Clean up removed keys from older versions
    const removedKeys = [
      'codeSourceType',
      'codeSourcePath',
      'codeSourceUrl',
      'codeSourceBranch',
    ];
    for (const key of removedKeys) {
      localStorage.removeItem(key);
    }
  }

  function saveToLocalStorage(): void {
    localStorage.setItem(LS_KEYS.agentCmd, agentCmd.value);
    localStorage.setItem(LS_KEYS.agentArgs, agentArgs.value);
    localStorage.setItem(LS_KEYS.lastProject, projectPath.value);
    localStorage.setItem(LS_KEYS.autoDocUpdate, String(autoDocUpdate.value));
  }

  // ── project config persistence ──
  async function saveToProject(projectRoot: string): Promise<{ success: boolean }> {
    const args = agentArgs.value ? agentArgs.value.split(/\s+/).filter(Boolean) : [];
    return window.moduleAgent.saveAgentConfig(projectRoot, agentCmd.value, args, projectPath.value, autoDocUpdate.value);
  }

  async function loadFromProject(projectRoot: string): Promise<void> {
    const config = await window.moduleAgent.getAgentConfig(projectRoot);
    agentCmd.value = config.command;
    agentArgs.value = (config.args || []).join(' ');
    projectPath.value = config.projectPath || projectRoot;
    if (config.summarizationEnabled !== undefined) {
      autoDocUpdate.value = config.summarizationEnabled;
    }
  }

  return {
    // state refs
    agentCmd,
    agentArgs,
    projectPath,
    autoDocUpdate,
    // functions
    loadFromLocalStorage,
    saveToLocalStorage,
    saveToProject,
    loadFromProject,
  };
});
