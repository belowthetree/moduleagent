/**
 * useModuleAgent — provides the ModuleAgentApi implementation.
 *
 * In Tauri + sidecar mode: HTTP API client.
 * Backward-compatible: also sets window.moduleAgent for direct access.
 */

import type { ModuleAgentApi } from '../types/preload';
import { getApi } from './useApi';

export function useModuleAgent(): ModuleAgentApi {
  return getApi();
}

// For direct window.moduleAgent access in components that weren't refactored yet
export function installModuleAgent(): void {
  if (typeof window !== 'undefined') {
    (window as any).moduleAgent = getApi();
  }
}
