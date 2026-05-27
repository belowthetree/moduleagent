export type CoreStatus = 'idle' | 'streaming' | 'error' | 'disconnected' | 'loading';

export interface CoreMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  time: string;
}

export interface AgentInfo {
  name: string;
  status: CoreStatus;
}

export interface InitResult {
  moduleNames: string[];
  rootAgent: string;
}

export interface CoreCallbacks {
  onStreamChunk: (moduleName: string, text: string, type: 'message' | 'thought') => void;
  onStreamComplete: (moduleName: string) => void;
  onStreamError: (moduleName: string, error: string) => void;
  onStatusChange: (status: CoreStatus) => void;
  onMessage: (message: CoreMessage) => void;
}
