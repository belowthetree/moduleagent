// ============================================================================
// HandlerContext — 所有 IPC handler 注册函数共享的上下文
//
// 每个 handler 文件导出 registerXxxHandlers(ctx) 函数，
// 通过此上下文访问主进程资源（Core、窗口、状态管理器等）。
// ============================================================================

import type { BrowserWindow } from 'electron';
import type { ModuleAgentCore } from '../../core/ModuleAgentCore.js';
import type { AgentStateManager } from '../../agents/AgentStateManager.js';
import type { ExperienceSummarizer } from '../../core/ExperienceSummarizer.js';
import type { Logger } from '../../core/Logger.js';
import type { DiffSummary } from '../../types/shared.js';

/** 所有 IPC handler 注册函数共享的上下文。ElectronBridge 构造时创建，handler 文件通过此接口访问主进程资源。 */
export interface HandlerContext {
  /** 统一 Agent 编排核心 */
  core: ModuleAgentCore;
  /** Electron 主窗口引用 */
  mainWindow: BrowserWindow;
  /** 流累积 + 上下文持久化（可能为 null，在 project:scan 后初始化） */
  stateManager: AgentStateManager | null;
  /** 工作区 diff 结果缓存，按模块名索引 */
  diffCache: Map<string, DiffSummary>;
  /** 系统提示词（main/sub/role） */
  prompts: { mainPrompt: string; subPrompt: string; rolePrompt: string };
  /** 配置文件目录 */
  configDir: string;
  /** 日志实例 */
  logger: Logger;
  /** 经验总结器 */
  summarizer: ExperienceSummarizer;
  /** 是否启用总结 */
  summarizationEnabled: boolean;
  /** 模块 Agent 发送锁（按模块名串行化） */
  sendLock: Map<string, Promise<void>>;
  /** 角色 Agent 发送锁（按角色名串行化） */
  roleSendLock: Map<string, Promise<void>>;
  /** Agent 运行状态映射 */
  agentStatus: Map<string, 'idle' | 'streaming' | 'error'>;
  /** 触发工作区变更检测（agent:send 后处理） */
  _triggerWorkspaceDiff: (moduleName: string, workspaceCwd: string, projectRoot: string) => void;
  /** 获取 Electron app 根路径 */
  _getBasePath: () => string;
}
  mainWindow: BrowserWindow;
  stateManager: AgentStateManager | null;
  diffCache: Map<string, DiffSummary>;
  prompts: { mainPrompt: string; subPrompt: string; rolePrompt: string };
  configDir: string;
  logger: Logger;
  summarizer: ExperienceSummarizer;
  summarizationEnabled: boolean;
  sendLock: Map<string, Promise<void>>;
  roleSendLock: Map<string, Promise<void>>;
  agentStatus: Map<string, 'idle' | 'streaming' | 'error'>;
  _triggerWorkspaceDiff: (moduleName: string, workspaceCwd: string, projectRoot: string) => void;
  _getBasePath: () => string;
}
