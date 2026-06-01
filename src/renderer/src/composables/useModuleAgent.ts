// ---------------------------------------------------------------------------
// renderer/src/composables/useModuleAgent.ts — Electron IPC 桥接
// 获取 window.moduleAgent API 的便捷 composable
// ---------------------------------------------------------------------------

import type { ModuleAgentApi } from '../../../types/shared'

export function useModuleAgent(): ModuleAgentApi {
  if (!window.moduleAgent) {
    console.warn('window.moduleAgent is not available (not running in Electron)')
  }
  return window.moduleAgent
}
