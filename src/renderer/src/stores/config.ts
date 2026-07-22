// ---------------------------------------------------------------------------
// renderer/src/stores/config.ts — 配置 Pinia Store
// ---------------------------------------------------------------------------

import { defineStore } from 'pinia';
import { ref } from 'vue';

const LS_KEYS = {
  provider: 'provider',
  apiKey: 'apiKey',
  baseUrl: 'baseUrl',
  model: 'model',
  lastProject: 'lastProject',
  autoDocUpdate: 'autoDocUpdate',
} as const;

export const useConfigStore = defineStore('config', () => {
  const provider = ref('anthropic');
  const apiKey = ref('');
  const baseUrl = ref('');
  const model = ref('');
  const projectPath = ref('');
  const autoDocUpdate = ref(true);

  function loadFromLocalStorage(): void {
    provider.value = localStorage.getItem(LS_KEYS.provider) || 'anthropic';
    apiKey.value = localStorage.getItem(LS_KEYS.apiKey) || '';
    baseUrl.value = localStorage.getItem(LS_KEYS.baseUrl) || '';
    model.value = localStorage.getItem(LS_KEYS.model) || '';
    autoDocUpdate.value = localStorage.getItem(LS_KEYS.autoDocUpdate) !== 'false';

    projectPath.value = localStorage.getItem(LS_KEYS.lastProject) || '';

    const removedKeys = [
      'codeSourceType', 'codeSourcePath', 'codeSourceUrl', 'codeSourceBranch',
      'agentCmd', 'agentArgs',
    ];
    for (const key of removedKeys) {
      localStorage.removeItem(key);
    }
  }

  function saveToLocalStorage(): void {
    localStorage.setItem(LS_KEYS.provider, provider.value);
    localStorage.setItem(LS_KEYS.apiKey, apiKey.value);
    localStorage.setItem(LS_KEYS.baseUrl, baseUrl.value);
    localStorage.setItem(LS_KEYS.model, model.value);
    localStorage.setItem(LS_KEYS.lastProject, projectPath.value);
    localStorage.setItem(LS_KEYS.autoDocUpdate, String(autoDocUpdate.value));
  }

  async function saveToProject(projectRoot: string): Promise<{ success: boolean; error?: string }> {
    const result = await window.moduleAgent.saveAgentConfig(
      projectRoot,
      provider.value,
      apiKey.value,
      baseUrl.value,
      model.value,
      projectPath.value,
      autoDocUpdate.value,
    );
    // 主进程校验失败会拒绝写盘并返回 error，抛出由调用方（SetupView/SettingsDialog）展示
    if (!result.success) {
      throw new Error(result.error || '配置保存失败');
    }
    return result;
  }

  async function loadFromProject(projectRoot: string): Promise<void> {
    const config = await window.moduleAgent.getAgentConfig(projectRoot);
    provider.value = config.provider || 'anthropic';
    apiKey.value = config.apiKey || '';
    baseUrl.value = config.baseUrl || '';
    model.value = config.model || '';
    projectPath.value = config.projectPath || projectRoot;
    if (config.summarizationEnabled !== undefined) {
      autoDocUpdate.value = config.summarizationEnabled;
    }
  }

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    projectPath,
    autoDocUpdate,
    loadFromLocalStorage,
    saveToLocalStorage,
    saveToProject,
    loadFromProject,
  };
});
