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
  /** 工具调用通知。moduleName: 触发模块, toolName: 工具名, toolStatus: 状态, toolDetail: 详细信息 */
  onToolCall?: (moduleName: string, toolName: string, toolStatus: string, toolDetail?: string) => void;
}

// ============================================================================
// IAgentBridge — 桥接层公共契约
//
// ElectronBridge 和 TuiBridge 均实现此接口，确保两座桥接有一致的生命周期
// 和核心 agent 操作 API。新桥接（如 HTTP server）可以此接口为模板实现。
// ============================================================================

export interface IAgentBridge {
  /** 初始化 Core 并扫描项目，返回模块列表 */
  init(projectRoot: string): Promise<InitResult>;
  /** 释放 Core 资源，清理状态 */
  dispose(): Promise<void>;
  /** 向指定模块 Agent 发送消息 */
  sendMessage(moduleName: string, text: string): Promise<{ result?: { reply: string }; error?: string }>;
  /** 取消指定模块 Agent 的当前流式响应 */
  cancelAgent(moduleName: string): Promise<void>;
  /** 获取当前模块图（TUI 可据此渲染节点树） */
  getGraph(): unknown | null;
  /** 列出当前已加载的 Agent 名称 */
  listAgents(): string[];
}
