import { defineStore } from 'pinia';
import { ref } from 'vue';

// localStorage 仅用于记录上次项目路径
const LS_KEY_LAST_PROJECT = 'lastProject';

export const useConfigStore = defineStore('config', () => {
  const agentCmd = ref('opencode');
  const agentArgs = ref('acp');
  const projectPath = ref('');
  const autoDocUpdate = ref(true);

  // ── 从 localStorage 恢复上次项目路径 ──
  function loadLastProject(): void {
    const legacyWorkspace = localStorage.getItem('lastWorkspace');
    if (legacyWorkspace) {
      localStorage.setItem(LS_KEY_LAST_PROJECT, legacyWorkspace);
      localStorage.removeItem('lastWorkspace');
    }
    projectPath.value = localStorage.getItem(LS_KEY_LAST_PROJECT) || '';
  }

  function saveLastProject(): void {
    localStorage.setItem(LS_KEY_LAST_PROJECT, projectPath.value);
  }

  // ── 从 .module-agent.json 加载项目配置（唯一数据源） ──
  async function loadFromProject(projectRoot: string): Promise<void> {
    const config = await window.moduleAgent.getAgentConfig(projectRoot);
    agentCmd.value = config.command || 'opencode';
    agentArgs.value = (config.args || []).join(' ');
    projectPath.value = config.projectPath || projectRoot;
    if (config.summarizationEnabled !== undefined) {
      autoDocUpdate.value = config.summarizationEnabled;
    }
  }

  // ── 保存到 .module-agent.json ──
  async function saveToProject(projectRoot: string): Promise<{ success: boolean }> {
    const args = agentArgs.value ? agentArgs.value.split(/\s+/).filter(Boolean) : [];
    return window.moduleAgent.saveAgentConfig(projectRoot, agentCmd.value, args, projectPath.value, autoDocUpdate.value);
  }

  return {
    agentCmd,
    agentArgs,
    projectPath,
    autoDocUpdate,
    loadLastProject,
    saveLastProject,
    loadFromProject,
    saveToProject,
  };
});
