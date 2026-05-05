import type { ModuleAgentApi } from '../../../types/preload'

export function useModuleAgent(): ModuleAgentApi {
  if (!window.moduleAgent) {
    console.warn('window.moduleAgent is not available (not running in Electron)')
  }
  return window.moduleAgent
}
