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

// Patch window with moduleAgent — preserve existing DOM constructors
if (typeof (globalThis as any).window !== 'undefined') {
  (globalThis as any).window.moduleAgent = mockApi;
} else {
  (globalThis as any).window = {
    moduleAgent: mockApi,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

// Polyfill Event constructors for happy-dom compatibility with @vue/test-utils
// happy-dom doesn't fully implement MouseEvent / WheelEvent constructors
if (typeof (globalThis as any).MouseEvent === 'undefined') {
  class PolyfillMouseEvent extends (globalThis as any).Event {
    public button: number;
    public clientX: number;
    public clientY: number;
    constructor(type: string, init?: MouseEventInit) {
      super(type, init);
      this.button = init?.button ?? 0;
      this.clientX = init?.clientX ?? 0;
      this.clientY = init?.clientY ?? 0;
    }
  }
  (globalThis as any).MouseEvent = PolyfillMouseEvent;
}

if (typeof (globalThis as any).WheelEvent === 'undefined') {
  class PolyfillWheelEvent extends (globalThis as any).MouseEvent {
    public deltaY: number;
    public deltaX: number;
    constructor(type: string, init?: WheelEventInit) {
      super(type, init as MouseEventInit);
      this.deltaY = init?.deltaY ?? 0;
      this.deltaX = init?.deltaX ?? 0;
    }
  }
  (globalThis as any).WheelEvent = PolyfillWheelEvent;
}
