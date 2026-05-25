import { defineStore } from 'pinia';
import { ref } from 'vue';

// localStorage 键名——冻结约定，必须与 renderer.ts 完全一致
const LS_KEYS = {
  agentCmd: 'agentCmd',
  agentArgs: 'agentArgs',
  lastProject: 'lastProject',
  autoDocUpdate: 'autoDocUpdate',
} as const;

export const useConfigStore = defineStore('config', () => {
  // ── 状态 ──
  const agentCmd = ref('opencode');
  const agentArgs = ref('acp');
  const projectPath = ref('');
  const autoDocUpdate = ref(true);

  // ── localStorage 持久化 ──
  function loadFromLocalStorage(): void {
    agentCmd.value = localStorage.getItem(LS_KEYS.agentCmd) || 'opencode';
    agentArgs.value = localStorage.getItem(LS_KEYS.agentArgs) || 'acp';
    autoDocUpdate.value = localStorage.getItem(LS_KEYS.autoDocUpdate) !== 'false';

    // 迁移：旧版 `lastWorkspace` 键 → `lastProject`
    const legacyWorkspace = localStorage.getItem('lastWorkspace');
    if (legacyWorkspace) {
      localStorage.setItem(LS_KEYS.lastProject, legacyWorkspace);
      localStorage.removeItem('lastWorkspace');
    }

    projectPath.value = localStorage.getItem(LS_KEYS.lastProject) || '';

    // 清理旧版本中已移除的键
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

  // ── 项目配置持久化 ──
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
    // 状态引用
    agentCmd,
    agentArgs,
    projectPath,
    autoDocUpdate,
    // 函数
    loadFromLocalStorage,
    saveToLocalStorage,
    saveToProject,
    loadFromProject,
  };
});
