// ---------------------------------------------------------------------------
// main/bridge.ts — ElectronBridge：Electron 主进程 Core 桥接层
//
// 职责（精简后）：
//   1. 创建 ModuleAgentCore + 配置 PostSendHooks
//   2. 构建 HandlerContext（仅 IPC/传输层资源）
//   3. 委托 10 个领域 handler 注册全部 ~46 个 IPC 通道
//
// 状态管理（AgentStateManager、agentStatus、sendLock、prompts）已移入 Core 层。
// Post-send 逻辑（summarizer + workspace diff）通过 PostSendHooks 注入 Core。
// ============================================================================

import path from 'path';
import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel } from '../protocol/IpcChannels.js';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { defaultLogger, type Logger } from '../core/Logger.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import { createPostSendHook } from '../core/PostSendHooks.js';
import { getPromptConfigDir, ensureConfigFiles } from '../core/ConfigPaths.js';
import type { DiffSummary } from '../types/shared.js';
import type { CoreCallbacks, IAgentBridge } from '../core/CoreTypes.js';
import type { HandlerContext } from './handlers/HandlerContext.js';

// Handler registration functions
import { registerDialogHandlers } from './handlers/dialogHandlers.js';
import { registerProjectHandlers } from './handlers/projectHandlers.js';
import { registerAgentHandlers } from './handlers/agentHandlers.js';
import { registerContextHandlers } from './handlers/contextHandlers.js';
import { registerConfigHandlers } from './handlers/configHandlers.js';
import { registerRoleHandlers } from './handlers/roleHandlers.js';
import { registerWorkflowHandlers } from './handlers/workflowHandlers.js';
import { registerMigrationHandlers } from './handlers/migrationHandlers.js';
import { registerKnowledgeHandlers } from './handlers/knowledgeHandlers.js';
import { registerWorkspaceDiffHandlers } from './handlers/workspaceDiffHandlers.js';

// ============================================================================
// ElectronBridge — Electron 桥接层（编排层）
//
// 架构（精简后）：
//   ElectronBridge (~80行)  ← 编排
//     ├── dialogHandlers       ← 1 通道
//     ├── projectHandlers      ← 3 通道
//     ├── agentHandlers        ← 6 通道（委托给 core.modules.sendMessage）
//     ├── contextHandlers      ← 3 通道（委托给 core.modules）
//     ├── configHandlers       ← 2 通道
//     ├── roleHandlers         ← 9 通道（委托给 core.roles.sendMessage）
//     ├── workflowHandlers     ← 9 通道
//     ├── migrationHandlers    ← 2 通道
//     ├── knowledgeHandlers    ← 5 通道
//     └── workspaceDiffHandlers← 5 通道
//
// HandlerContext 从 14 字段缩减至 6 字段。
// ============================================================================

export class ElectronBridge implements IAgentBridge {
  private mainWindow: BrowserWindow;
  private core: ModuleAgentCore;
  private logger: Logger;
  private configDir: string;

  // 保留在 bridge 的共享资源
  private summarizer: ExperienceSummarizer;
  private summarizationEnabled = false;
  private diffCache = new Map<string, DiffSummary>();

  // Handler context — passed to all handler registration functions
  private handlerCtx: HandlerContext;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logger = defaultLogger;
    this.summarizer = new ExperienceSummarizer(this.logger);

    const basePath = this._getBasePath();
    this.configDir = getPromptConfigDir(basePath);

    const callbacks: CoreCallbacks = this._buildCallbacks();

    // 构建 PostSendHook（summarizer + workspace diff）
    const onPostSend = createPostSendHook({
      logger: this.logger,
      summarizer: this.summarizer,
      getSummarizationEnabled: () => this.summarizationEnabled,
      configDir: this.configDir,
      getProjectRoot: () => this.core.getProjectRoot(),
      diffCache: this.diffCache,
      onDiffReady: (moduleName, summary) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.WorkspaceDiffReady, {
            moduleName,
            summary,
          });
        }
      },
    });

    this.core = new ModuleAgentCore({
      callbacks,
      basePath,
      configDir: this.configDir,
      logger: this.logger,
      onPostSend,
      onSessionUpdate: (moduleName, _sessionId, notification) => {
        // Bridge only handles IPC push — stream accumulation is in core
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const acc = this.core.modules.getStreamState(moduleName);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.AgentStream, {
            moduleName,
            update,
            data: notification.update,
            reply: acc?.reply,
            thinking: acc?.thinking,
            tools: acc?.tools,
            timeline: acc?.timeline,
            sections: acc?.sections,
          });
        }
      },
      onRoleSessionUpdate: (roleName, _sessionId, notification) => {
        const ctxKey = `workrole:${roleName}`;
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const acc = this.core.modules.getStreamState(ctxKey);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.RoleStream, {
            moduleName: roleName,
            update,
            data: notification.update,
            reply: acc?.reply,
            thinking: acc?.thinking,
            tools: acc?.tools,
            timeline: acc?.timeline,
            sections: acc?.sections,
          });
        }
      },
    });

    // Build handler context — shared mutable state
    this.handlerCtx = {
      core: this.core,
      mainWindow: this.mainWindow,
      diffCache: this.diffCache,
      configDir: this.configDir,
      logger: this.logger,
      _getBasePath: this._getBasePath.bind(this),
    } as HandlerContext;

    // Wire summarizationEnabled through HandlerContext (mutable — configHandlers updates it)
    Object.defineProperty(this.handlerCtx, 'summarizationEnabled', {
      get: () => this.summarizationEnabled,
      set: (v: boolean) => { this.summarizationEnabled = v; },
    });
  }

  // -----------------------------------------------------------------------
  // IPC 注册 — 委托给领域 handler
  // -----------------------------------------------------------------------

  registerAllHandlers(): void {
    registerDialogHandlers(this.handlerCtx);
    registerProjectHandlers(this.handlerCtx);
    registerAgentHandlers(this.handlerCtx);
    registerContextHandlers(this.handlerCtx);
    registerConfigHandlers(this.handlerCtx);
    registerRoleHandlers(this.handlerCtx);
    registerWorkflowHandlers(this.handlerCtx);
    registerMigrationHandlers(this.handlerCtx);
    registerKnowledgeHandlers(this.handlerCtx);
    registerWorkspaceDiffHandlers(this.handlerCtx);
  }

  // -----------------------------------------------------------------------
  // IAgentBridge 实现
  // -----------------------------------------------------------------------

  async init(projectRoot: string): Promise<{ moduleNames: string[]; rootAgent: string }> {
    this.configDir = getPromptConfigDir(this._getBasePath(), projectRoot);
    ensureConfigFiles(path.join(this._getBasePath(), 'config'), projectRoot);
    return this.core.init(projectRoot, this.configDir);
  }

  async dispose(): Promise<void> {
    this.core.dispose();
  }

  async sendMessage(moduleName: string, text: string): Promise<{ result?: { reply: string }; error?: string }> {
    if (!this.core.isInitialized()) return { error: 'not initialized' };
    return this.core.modules.sendMessage(text, moduleName);
  }

  async cancelAgent(moduleName: string): Promise<void> {
    const entry = this.core.modules.getAgent(moduleName);
    if (entry) {
      await entry.agent.cancel();
    }
  }

  getGraph() {
    return this.core.getGraph();
  }

  listAgents(): string[] {
    return this.core.modules.listAgents();
  }

  async cleanup(): Promise<void> {
    return this.dispose();
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  private _getBasePath(): string {
    const { app } = require('electron');
    return app.getAppPath();
  }

  private _buildCallbacks(): CoreCallbacks {
    const self = this;
    return {
      onStreamChunk(moduleName, text) {
        if (self.mainWindow && !self.mainWindow.isDestroyed()) {
          self.mainWindow.webContents.send(IpcChannel.Push.AgentStream, {
            moduleName, update: text, data: {}, reply: text,
          });
        }
      },
      onStreamComplete(moduleName) {
        // Status is now managed by core; bridge just forwards
      },
      onStreamError(moduleName, error) {
        self.logger.error(`[${moduleName}] stream error: ${error}`);
      },
      onStatusChange(_status) {
        // Status is now managed by core's per-module tracking
      },
      onMessage(message) {
        // Core manages status internally
      },
      onModuleStatusChange(moduleName, status) {
        if (self.mainWindow && !self.mainWindow.isDestroyed()) {
          self.mainWindow.webContents.send(IpcChannel.Push.AgentStatus, {
            name: moduleName, status,
          });
        }
      },
    };
  }
}
