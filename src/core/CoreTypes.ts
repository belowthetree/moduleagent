// ---------------------------------------------------------------------------
// core/CoreTypes.ts — Core 层核心类型定义
// 包含 CoreCallbacks、IAgentBridge 接口、状态/消息/Agent 信息类型
// ---------------------------------------------------------------------------

export type CoreStatus = 'idle' | 'streaming' | 'error' | 'disconnected' | 'loading';

export interface CoreMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  time: string;
  /** 关联的模块名（系统消息时用于路由到正确的模块上下文） */
  moduleName?: string;
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
  onToolCall?: (moduleName: string, toolName: string, toolStatus: string, toolDetail?: string, toolCallId?: string) => void;
  /** 跨模块通信消息。source: 发起模块, target: 目标模块, direction: sent/received, phase: request/response, content: 消息内容 */
  onCrossModuleMessage?: (source: string, target: string, direction: 'sent' | 'received', phase: 'request' | 'response', content: string) => void;
  /** 模块状态变更通知（由跨模块通信触发） */
  onModuleStatusChange?: (moduleName: string, status: 'idle' | 'streaming' | 'error') => void;
  /** 错误上报（如 init 扫描失败回落空图、配置无效等），message 为可读描述 */
  onError?: (message: string, error: Error) => void;
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
