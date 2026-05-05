import { createMockModuleAgentApi } from './src/renderer/src/__mocks__/moduleAgent';
import type { ModuleAgentApi } from './src/types/preload';

declare global {
  interface Window {
    moduleAgent: ModuleAgentApi;
  }
}

window.moduleAgent = createMockModuleAgentApi();
