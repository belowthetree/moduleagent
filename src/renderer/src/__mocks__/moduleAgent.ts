// ---------------------------------------------------------------------------
// renderer/src/__mocks__/moduleAgent.ts — window.moduleAgent Mock
// 在测试环境中模拟 Electron contextBridge 的 API
// ---------------------------------------------------------------------------

import type {
  ModuleAgentApi,
  AgentStreamData,
  AgentStatusData,
  CrossContextData,
  AgentStatus,
  ScanResult,
  TreeNode,
  ChatMsg,
  MigrationData,
} from '../../../types/shared';

interface MockInternals {
  streamCallbacks: Array<(data: AgentStreamData) => void>;
  crossContextCallbacks: Array<(data: CrossContextData) => void>;
  statusCallbacks: Array<(data: AgentStatusData) => void>;
}

const internalsMap = new WeakMap<ModuleAgentApi, MockInternals>();

function getInternals(mock: ModuleAgentApi): MockInternals {
  const internals = internalsMap.get(mock);
  if (!internals) {
    throw new Error('Mock internals not found — use createMockModuleAgentApi()');
  }
  return internals;
}

export function createMockModuleAgentApi(): ModuleAgentApi {
  const internals: MockInternals = {
    streamCallbacks: [],
    crossContextCallbacks: [],
    statusCallbacks: [],
  };

  const api: ModuleAgentApi = {
    selectDir: (_title: string): Promise<string | null> => {
      return Promise.resolve('/mock/selected/dir');
    },

    scanProject: (_projectRoot: string): Promise<ScanResult> => {
      return Promise.resolve({
        root: '/mock/project',
        moduleCount: 5,
      });
    },

    getTree: (): Promise<TreeNode | null> => {
      return Promise.resolve({
        name: 'root',
        path: '/mock/project',
        description: 'Mock project tree',
        children: [
          {
            name: 'module-a',
            path: '/mock/project/module-a',
            description: 'Module A',
            children: [],
          },
          {
            name: 'module-b',
            path: '/mock/project/module-b',
            description: 'Module B',
            children: [],
          },
        ],
      });
    },

    startAgent: (_moduleName: string, _cmd: string, _args: string[], _cwd: string): Promise<{ sessionId?: string; error?: string }> => {
      return Promise.resolve({ sessionId: 'mock-session-id' });
    },

    sendMessage: (_moduleName: string, _text: string, _cwd?: string): Promise<{ result?: { reply: string; thinking: string; tools: string; stopReason: string }; error?: string }> => {
      return Promise.resolve({ result: { reply: 'mock reply', thinking: '', tools: '', stopReason: 'end_turn' } });
    },

    cancelAgent: (_moduleName: string): Promise<{ accumulated?: { reply: string; thinking: string; tools: string; finished?: boolean; sections: { thinking: boolean; tools: boolean; reply: boolean } } }> => {
      return Promise.resolve({ accumulated: { reply: '', thinking: '', tools: '', finished: true, sections: { thinking: false, tools: false, reply: false } } });
    },

    stopAgent: (_moduleName: string): Promise<{}> => {
      return Promise.resolve({});
    },

    isAgentRunning: (_moduleName: string): Promise<boolean> => {
      return Promise.resolve(false);
    },

    getRunningAgents: (): Promise<{ name: string; status: AgentStatus }[]> => {
      return Promise.resolve([]);
    },

    onAgentStream: (callback: (data: AgentStreamData) => void): (() => void) => {
      internals.streamCallbacks.push(callback);
      return () => {
        const idx = internals.streamCallbacks.indexOf(callback);
        if (idx !== -1) {
          internals.streamCallbacks.splice(idx, 1);
        }
      };
    },

    onAgentStatus: (callback: (data: AgentStatusData) => void): (() => void) => {
      internals.statusCallbacks.push(callback);
      return () => {
        const idx = internals.statusCallbacks.indexOf(callback);
        if (idx !== -1) {
          internals.statusCallbacks.splice(idx, 1);
        }
      };
    },

    saveAgentConfig: (
      _projectRoot: string,
      _cmd: string,
      _args: string[],
      _projectPath?: string,
    ): Promise<{ success: boolean }> => {
      return Promise.resolve({ success: true });
    },

    getAgentConfig: (_projectRoot: string): Promise<{
      command: string;
      args: string[];
      projectPath?: string;
    }> => {
      return Promise.resolve({
        command: 'opencode',
        args: ['acp'],
        projectPath: '/mock/project',
      });
    },

    onCrossContext: (callback: (data: CrossContextData) => void): (() => void) => {
      internals.crossContextCallbacks.push(callback);
      return () => {
        const idx = internals.crossContextCallbacks.indexOf(callback);
        if (idx !== -1) {
          internals.crossContextCallbacks.splice(idx, 1);
        }
      };
    },

    migrateCheck: (_keys: string[]): Promise<{ needed: string[]; streamNeeded: boolean }> => {
      return Promise.resolve({ needed: [], streamNeeded: false });
    },

    migrateData: (_payload: MigrationData): Promise<void> => {
      return Promise.resolve();
    },

    getContext: (_moduleName: string): Promise<ChatMsg[]> => {
      return Promise.resolve([]);
    },

    clearContext: (_moduleName: string): Promise<void> => {
      return Promise.resolve();
    },

    clearAllContexts: (): Promise<void> => {
      return Promise.resolve();
    },
  };

  internalsMap.set(api, internals);
  return api;
}

export function triggerStream(mock: ModuleAgentApi, data: AgentStreamData): void {
  const internals = getInternals(mock);
  for (const cb of internals.streamCallbacks) {
    cb(data);
  }
}

export function triggerCrossContext(mock: ModuleAgentApi, data: CrossContextData): void {
  const internals = getInternals(mock);
  for (const cb of internals.crossContextCallbacks) {
    cb(data);
  }
}

export function triggerStatus(mock: ModuleAgentApi, data: AgentStatusData): void {
  const internals = getInternals(mock);
  for (const cb of internals.statusCallbacks) {
    cb(data);
  }
}
