import { createMockModuleAgentApi } from './src/renderer/src/__mocks__/moduleAgent';

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
