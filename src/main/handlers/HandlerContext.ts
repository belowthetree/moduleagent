// ============================================================================
// HandlerContext — 所有 IPC handler 注册函数共享的上下文
//
// 每个 handler 文件导出 registerXxxHandlers(ctx) 函数，
// 通过此上下文访问主进程资源（Core、窗口、共享缓存等）。
//
// 状态管理（AgentStateManager、agentStatus、sendLock 等）已移入 Core 层，
// HandlerContext 仅保留 IPC/传输层必需的资源。
// ============================================================================

import type { BrowserWindow } from 'electron';
import type { ModuleAgentCore } from '../../core/ModuleAgentCore.js';
import type { Logger } from '../../core/Logger.js';

/** 所有 IPC handler 注册函数共享的上下文。ElectronBridge 构造时创建，handler 文件通过此接口访问主进程资源。 */
export interface HandlerContext {
  /** 统一 Agent 编排核心（拥有 stateManager、agentStatus、sendLock 等） */
  core: ModuleAgentCore;
  /** Electron 主窗口引用 */
  mainWindow: BrowserWindow;
  /** 配置文件目录 */
  configDir: string;
  /** 日志实例 */
  logger: Logger;
  /** 获取 Electron app 根路径 */
  _getBasePath: () => string;
  /** 是否启用经验总结（UI 配置，由 configHandlers 更新） */
  summarizationEnabled: boolean;
}
