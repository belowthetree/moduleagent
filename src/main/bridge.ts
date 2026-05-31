import path from 'path';
import fs from 'fs-extra';
import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannel } from '../protocol/IpcChannels.js';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import type { RoleConfig } from '../config/defaults.js';
import { defaultLogger, type Logger } from '../core/Logger.js';
import { AgentStateManager } from '../agents/AgentStateManager.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import * as WorkspaceDiff from '../core/WorkspaceDiff.js';
import {
  loadSystemPrompts,
} from '../agents/PromptBuilder.js';
import { getPromptConfigDir, ensureConfigFiles } from '../core/ConfigPaths.js';
import type { DiffSummary, ChatMsg } from '../types/shared.js';
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
// 职责：
//   1. 持有 ModuleAgentCore 实例 + AgentStateManager + ExperienceSummarizer
//   2. 构建 HandlerContext（共享上下文）
//   3. 委托 11 个领域 handler 注册全部 ~46 个 IPC 通道
//   4. 提供 _triggerWorkspaceDiff（agent 完成后异步 diff 工作区）
//
// 架构：
//   ElectronBridge (228行)  ← 编排
//     ├── dialogHandlers       ← 1 通道
//     ├── projectHandlers      ← 3 通道 (scan/getTree/generateModules)
//     ├── agentHandlers        ← 6 通道 (start/send/cancel/stop/...)
//     ├── contextHandlers      ← 3 通道
//     ├── configHandlers       ← 2 通道
//     ├── roleHandlers         ← 9 通道
//     ├── workflowHandlers     ← 9 通道
//     ├── migrationHandlers    ← 2 通道
//     ├── knowledgeHandlers    ← 5 通道
//     └── workspaceDiffHandlers← 5 通道
//
// 所有 handler 通过 HandlerContext 共享主进程资源，零循环依赖。
// ============================================================================

export class ElectronBridge implements IAgentBridge {
  private mainWindow: BrowserWindow;
  private core: ModuleAgentCore;
  private stateManager: AgentStateManager | null = null;
  private mcpBackend: unknown = null; // McpBackendServer — typed loosely to avoid import
  private summarizer: ExperienceSummarizer;
  private summarizationEnabled = true;
  private logger: Logger;
  private configDir: string;

  private prompts = { mainPrompt: '', subPrompt: '', rolePrompt: '' };
  private agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();
  private sendLock = new Map<string, Promise<void>>();
  private roleSendLock = new Map<string, Promise<void>>();
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

    this.core = new ModuleAgentCore({
      callbacks,
      basePath,
      configDir: this.configDir,
      logger: this.logger,
      onSessionUpdate: (moduleName, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        this.stateManager?.appendChunk(moduleName, update || '', notification.update as Record<string, unknown>);
        const acc = this.stateManager?.getStreamState(moduleName);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.AgentStream, {
            moduleName, sessionId, update,
            data: notification.update,
            reply: acc?.reply, thinking: acc?.thinking,
            tools: acc?.tools, timeline: acc?.timeline, sections: acc?.sections,
          });
        }
      },
      onRoleSessionUpdate: (roleName, sessionId, notification) => {
        const ctxKey = `workrole:${roleName}`;
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        this.stateManager?.appendChunk(ctxKey, update || '', notification.update as Record<string, unknown>);
        const acc = this.stateManager?.getStreamState(ctxKey);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.RoleStream, {
            moduleName: roleName, sessionId, update,
            data: notification.update,
            reply: acc?.reply, thinking: acc?.thinking,
            tools: acc?.tools, timeline: acc?.timeline, sections: acc?.sections,
          });
        }
      },
    });

    // Build handler context — all handler functions share this mutable object
    this.handlerCtx = {
      core: this.core,
      mainWindow: this.mainWindow,
      diffCache: this.diffCache,
      prompts: this.prompts,
      configDir: this.configDir,
      logger: this.logger,
      summarizer: this.summarizer,
      summarizationEnabled: this.summarizationEnabled,
      sendLock: this.sendLock,
      roleSendLock: this.roleSendLock,
      agentStatus: this.agentStatus,
      _triggerWorkspaceDiff: this._triggerWorkspaceDiff.bind(this),
      _getBasePath: this._getBasePath.bind(this),
    } as HandlerContext;

    // Wire mutable stateManager via proxy getter
    const self = this;
    Object.defineProperty(this.handlerCtx, 'stateManager', {
      get: () => self.stateManager,
      set: (v: AgentStateManager | null) => { self.stateManager = v; },
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
  // 工作区 Diff 触发（供 agent handler 后处理调用）
  // -----------------------------------------------------------------------

  private _triggerWorkspaceDiff(moduleName: string, workspaceCwd: string, projectRoot: string): void {
    if (!workspaceCwd || !projectRoot) return;
    const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
    if (!workspaceCwd.startsWith(workspaceBase)) return;

    const relPath = path.relative(workspaceBase, workspaceCwd);
    const sourceDir = relPath ? path.join(projectRoot, relPath) : projectRoot;

    setImmediate(() => {
      try {
        this.logger.info(`WorkspaceDiff: analyzing ${workspaceCwd} vs ${sourceDir}`);
        const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir);
        summary.moduleName = moduleName;
        this.diffCache.set(moduleName, summary);
        if (summary.files.length > 0) {
          this.logger.info(`WorkspaceDiff [${moduleName}]: ${summary.addedCount} added, ${summary.modifiedCount} modified, ${summary.deletedCount} deleted`);
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.WorkspaceDiffReady, {
            moduleName,
            summary: summary.files.length > 0 ? summary : null,
          });
        }
      } catch (err) {
        this.logger.error(`WorkspaceDiff error [${moduleName}]: ${(err as Error).message}`);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IpcChannel.Push.WorkspaceDiffReady, { moduleName, summary: null });
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // 清理
  // -----------------------------------------------------------------------

  // ── IAgentBridge 实现 ──

  async init(projectRoot: string): Promise<{ moduleNames: string[]; rootAgent: string }> {
    // 更新 configDir 指向项目的 .module-agent/config/
    this.configDir = getPromptConfigDir(this._getBasePath(), projectRoot);
    ensureConfigFiles(path.join(this._getBasePath(), 'config'), projectRoot);
    return this.core.init(projectRoot, this.configDir);
  }

  async dispose(): Promise<void> {
    this.core.dispose();
  }

  async sendMessage(moduleName: string, text: string): Promise<{ result?: { reply: string }; error?: string }> {
    // 委托给 agent:send handler（通过 IPC invoke 自调用）
    const { ipcMain } = await import('electron');
    // 直接使用 core 内部方法
    if (!this.core.isInitialized()) return { error: 'not initialized' };
    let entry = this.core.modules.getAgent(moduleName);
    if (!entry) entry = await this.core.modules.startAgent(moduleName);
    const result = await entry.launched.connection.prompt({
      sessionId: entry.sessionId,
      prompt: [{ type: 'text' as const, text }],
    });
    return { result: { reply: '' } };
  }

  async cancelAgent(moduleName: string): Promise<void> {
    const entry = this.core.modules.getAgent(moduleName);
    if (entry) {
      try { await entry.launched.connection.cancel({ sessionId: entry.sessionId }); } catch { /* ignore */ }
    }
  }

  getGraph() {
    return this.core.getGraph();
  }

  listAgents(): string[] {
    return this.core.modules.listAgents();
  }

  // 兼容旧 API
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
        self.agentStatus.set(moduleName, 'idle');
      },
      onStreamError(moduleName, error) {
        self.agentStatus.set(moduleName, 'error');
        self.logger.error(`[${moduleName}] stream error: ${error}`);
      },
      onStatusChange(_status) { /* handled by agentStatus map */ },
      onMessage(message) {
        self.agentStatus.set(message.name, 'idle');
      },
    };
  }
}
