// Mock API is created inline for tests
import type { ModuleAgentApi } from './src/types/preload';

function createMockModuleAgentApi(): ModuleAgentApi {
  const noop = () => {};
  const noopCleanup = () => () => {};
  return {
    selectDir: async () => null,
    scanProject: async () => ({ root: 'test', moduleCount: 1 }),
    generateModules: async () => ({ success: true, count: 0 }),
    getTree: async () => null,
    startAgent: async () => ({ sessionId: 'test-session' }),
    sendMessage: async () => ({ result: { reply: '', thinking: '', tools: '', stopReason: 'end_turn' } }),
    cancelAgent: async () => ({ accumulated: { reply: '', thinking: '', tools: '', sections: { thinking: false, tools: false, reply: false } } }),
    stopAgent: async () => ({}),
    isAgentRunning: async () => false,
    getRunningAgents: async () => [],
    onAgentStream: noopCleanup as any,
    onAgentStatus: noopCleanup as any,
    saveAgentConfig: async () => ({ success: true }),
    getAgentConfig: async () => ({ command: 'test', args: [], projectPath: '/test' }),
    migrateCheck: async () => ({ needed: [], streamNeeded: false }),
    migrateData: async () => {},
    getContext: async () => [],
    clearContext: async () => {},
    clearAllContexts: async () => {},
    onCrossContext: noopCleanup as any,
    getRoles: async () => [],
    saveRole: async () => ({ success: true }),
    deleteRole: async () => ({ success: true }),
    startRoleAgent: async () => ({ sessionId: 'test-role' }),
    sendRoleMessage: async () => ({ result: { reply: '', thinking: '', tools: '' } }),
    cancelRoleAgent: async () => ({ accumulated: { reply: '', thinking: '', tools: '', sections: { thinking: false, tools: false, reply: false } } }),
    stopRoleAgent: async () => ({}),
    isRoleAgentRunning: async () => false,
    getRoleContext: async () => [],
    clearRoleContext: async () => {},
    onRoleAgentStream: noopCleanup as any,
    onRoleAgentStatus: noopCleanup as any,
    knowledgeList: async () => [],
    knowledgeRead: async () => null,
    knowledgeSave: async () => ({ success: true }),
    knowledgeCreate: async () => ({ name: 'test', filename: 'test.md', content: '' }),
    knowledgeDelete: async () => ({ success: true }),
    workflowList: async () => [],
    workflowLoad: async () => ({ name: '', dir: '', steps: [] }),
    workflowCreate: async () => ({ success: true }),
    workflowDelete: async () => ({ success: true }),
    workflowStepSave: async () => ({ success: true }),
    workflowStepDelete: async () => ({ success: true }),
    workflowStepAdd: async () => ({ success: true, stepName: 'step-1' }),
    workflowExecute: async () => ({ success: true, results: [] }),
    workflowCancel: async () => {},
    workflowStatus: async () => null,
  };
}

// In-memory localStorage for Node environment
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
};

const mockApi = createMockModuleAgentApi();
(globalThis as any).window = {
  moduleAgent: mockApi,
  addEventListener: () => {},
  removeEventListener: () => {},
};
