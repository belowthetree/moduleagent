// ---------------------------------------------------------------------------
// tui/bridge.ts — TuiBridge：TUI 模式 Core 桥接层
//
// 职责（精简后）：
//   1. 持有 ModuleAgentCore + TuiSessionStore
//   2. 将 CoreCallbacks 翻译为 store 操作 + tuiState signals
//   3. 用户操作委托给 Core，展示数据从 Core 查询
//
// 消息存储/持久化由 Core 层 AgentStateManager 负责，TUI 只做格式转换和展示。
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { defaultLogger } from '../core/Logger.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import type { AgentStatus, ChatMessage, MessageType } from './types.js';
import type { CoreCallbacks, CoreStatus, CoreMessage, InitResult, IAgentBridge } from '../core/CoreTypes.js';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { RoleConfigData } from '../types/shared.js';
import type { RoleConfig } from '../config/defaults.js';
import { tuiState } from './state.js';
import { InputHistoryPersistence } from './persistence.js';
import { TuiSessionStore } from './TuiSessionStore.js';
import { getProjectConfigDir, ensureConfigFiles } from '../core/ConfigPaths.js';
import { createPostSendHook } from '../core/PostSendHooks.js';

function findRepoRoot(): string {
  let dir = __dirname || path.resolve(process.argv[1] || process.cwd(), '..');
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export class TuiBridge implements IAgentBridge {
  core: ModuleAgentCore;
  private store = new TuiSessionStore();
  private status: AgentStatus = 'idle';
  private loadedModules = new Set<string>();
  private summarizer: ExperienceSummarizer;
  private configDir: string;
  private summarizationEnabled = false;

  // 输入历史持久化
  private historyStore: InputHistoryPersistence | null = null;

  constructor() {
    this.summarizer = new ExperienceSummarizer(defaultLogger);
    this.configDir = '';

    const self = this;
    const callbacks: CoreCallbacks = this._buildCallbacks(self);

    const repoRoot = findRepoRoot();
    this.core = new ModuleAgentCore({
      callbacks,
      basePath: repoRoot,
      configDir: path.join(repoRoot, 'config'),
      logger: defaultLogger,
      onRoleSessionUpdate: (roleName, _sid, notification) => {
        self._onSubsystemChunk('role', roleName, notification);
      },
      onWorkflowSessionUpdate: (agentName, _sid, notification) => {
        self._onSubsystemChunk('wf', agentName, notification);
      },
      onCrossContext: (source, target, direction, phase, content) => {
        const arrow = direction === 'sent' ? '→' : '←';
        const label = phase === 'request' ? '请求' : '响应';
        const fullContent = `${arrow} ${source} → ${target} [${label}]\n${content}`;
        const msg: ChatMessage = {
          id: `cross-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system',
          msgType: 'cross_context',
          content: fullContent,
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      },
      onPostSend: createPostSendHook({
        logger: defaultLogger,
        summarizer: self.summarizer,
        getSummarizationEnabled: () => self.summarizationEnabled,
        configDir: '',
        getProjectRoot: () => self.core.getProjectRoot(),
      }),
    });
  }

  // ── Callback 构建 ──

  private _buildCallbacks(self: TuiBridge): CoreCallbacks {
    return {
      onStreamChunk: (moduleName, text, type) => {
        // 只追加当前模块的流式输出，避免跨模块通信时子模块输出污染当前视图
        if (moduleName !== self.core.getCurrentAgent()) return;
        const msgType: MessageType = type === 'message' ? 'agent_reply' : 'agent_thought';
        const msgId = type === 'message' ? self.store.replyId : self.store.thoughtId;
        self.store.appendChunk(msgId, text, msgType);
        self.store.syncTo(tuiState);
      },
      onStreamComplete: (moduleName) => {
        if (moduleName !== self.core.getCurrentAgent()) return;
        self.store.finalizeStream();
        self.store.syncTo(tuiState);

        const collapsed = self.store.getCollapsedThoughts();
        tuiState.setCollapsedThoughts(collapsed);

        self.core.modules.setAgentStatus(moduleName, 'idle');
        self._updateGlobalStatus();
        tuiState.setAgentCwd(self.getAgentCwd());
      },
      onStreamError: (moduleName, error) => {
        self.core.modules.setAgentStatus(moduleName, 'error');
        self._updateGlobalStatus();
        if (moduleName === self.core.getCurrentAgent()) {
          self.store.addErrorMsg(error);
          self.store.syncTo(tuiState);
        }
      },
      onStatusChange: (_status: CoreStatus) => {
        self._updateGlobalStatus();
      },
      onMessage: (message: CoreMessage) => {
        if (message.moduleName && message.moduleName !== self.core.getCurrentAgent()) return;
        self.store.messages.push({
          ...message,
          msgType: message.role === 'system' ? 'system' : 'agent_reply',
        });
        self.store.syncTo(tuiState);
      },
      onToolCall: (moduleName, toolName, toolStatus, toolDetail, toolCallId) => {
        // 非当前模块的 tool call 不操作 store（避免跨模块通信污染视图）
        if (moduleName !== self.core.getCurrentAgent()) return;

        const isNewTool = toolStatus === 'running' || toolStatus === 'pending';
        if (isNewTool) {
          self.store.finalizeStream();
          self.store.startStream();
          self.store.syncTo(tuiState);
        }

        if (toolName.startsWith('private ') || toolName.includes('(') || toolName.length > 60) {
          return;
        }

        const statusIcon = toolStatus === 'completed' ? '✓' : toolStatus === 'error' ? '✗' : '…';
        const displayName = toolName;

        let extra = '';
        try {
          if (toolDetail) {
            const detail = JSON.parse(toolDetail) as Record<string, unknown>;
            if (detail.targetModule) {
              extra = `→ ${detail.targetModule}`;
              const task = detail.task || detail.query;
              if (typeof task === 'string') extra += `: ${task.slice(0, 60)}`;
            } else if (detail.requestingModule) {
              extra = `← ${detail.requestingModule}`;
              const task = detail.task || detail.query;
              if (typeof task === 'string') extra += `: ${task.slice(0, 60)}`;
            } else {
              const p = detail.path || detail.filePath || detail.file || detail.directory;
              if (typeof p === 'string') {
                extra = p.length > 50 ? '…' + p.slice(-47) : p;
              } else {
                const keys = Object.keys(detail).filter(k => k !== 'title' && k !== 'status');
                const firstVal = keys.find(k => typeof detail[k] === 'string');
                if (firstVal) {
                  const val = detail[firstVal] as string;
                  extra = val.length > 50 ? val.slice(0, 47) + '…' : val;
                }
              }
            }
          }
        } catch { /* ignore */ }

        const content = `${statusIcon} ${displayName} ${extra}`.trim();
        const isCrossModule = displayName === 'module_call' || displayName === 'module_query';
        if (isCrossModule && !extra) return;

        const inFlight = statusIcon === '…';
        const msgs = self.store.messages;

        // 用 toolCallId + displayName 查找并更新已有消息，避免重复条目
        const tcid = toolCallId || `${displayName}`;

        if (inFlight) {
          let replaced = false;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m && m.msgType === 'tool_call' && m.content.startsWith('…') && m.content.includes(displayName)) {
              m.content = content;
              replaced = true;
              break;
            }
          }
          if (!replaced) {
            msgs.push({
              id: `tool-${tcid}-${Date.now()}`,
              role: 'system', msgType: 'tool_call',
              content, time: new Date().toLocaleTimeString(),
            });
          }
        } else {
          let updated = false;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m && m.msgType === 'tool_call' && m.id.startsWith(`tool-${toolCallId}-`)) {
              m.content = content;
              updated = true;
              break;
            }
          }
          if (!updated) {
            msgs.push({
              id: `tool-${toolCallId}-${Date.now()}`,
              role: 'system', msgType: 'tool_call',
              content, time: new Date().toLocaleTimeString(),
            });
          }
        }
        self.store.syncTo(tuiState);
      },
      onCrossModuleMessage: (source, target, direction, phase, content) => {
        if (source !== self.core.getCurrentAgent()) return;
        const shortContent = content.length > 100 ? content.slice(0, 100) + '…' : content;
        const statusIcon = phase === 'request' ? '…' : '✓';
        const toolName = direction === 'sent' ? `→ ${target}` : `← ${target}`;
        const toolMsg: ChatMessage = {
          id: `cross-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system', msgType: 'tool_call',
          content: `${statusIcon} module_call ${toolName}: ${shortContent}`,
          time: new Date().toLocaleTimeString(),
        };
        self.store.messages.push({ ...toolMsg });
        self.store.syncTo(tuiState);
      },
      onModuleStatusChange: (_moduleName, _status) => {
        tuiState.setModuleStatusVersion(tuiState.moduleStatusVersion() + 1);
        self._updateGlobalStatus();
      },
    };
  }

  // ── 子系统会话更新 helper ──

  private _onSubsystemChunk(prefix: string, agentName: string, notification: { update: unknown }): void {
    if (agentName !== this.core.getCurrentAgent()) return;
    const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
    const data = notification.update as Record<string, unknown>;
    if (update) defaultLogger.info(`[ACP:${prefix}] ${agentName} ← ${update}`);
    if (update === 'agent_message_chunk') {
      const block = data.content as { type?: string; text?: string } | undefined;
      if (block?.text) {
        this.store.appendChunk(this.store.replyId, block.text, 'agent_reply');
        this.store.syncTo(tuiState);
      }
    } else if (update === 'agent_thought_chunk') {
      const block = data.content as { type?: string; text?: string } | undefined;
      if (block?.text) {
        this.store.appendChunk(this.store.thoughtId, block.text, 'agent_thought');
        this.store.syncTo(tuiState);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  async init(projectRoot: string): Promise<InitResult> {
    const basePath = findRepoRoot();
    this.configDir = getProjectConfigDir(projectRoot);
    ensureConfigFiles(path.join(basePath, 'config'), projectRoot);

    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      this.summarizationEnabled = config.summarization?.enabled ?? false;
    } catch {
      this.summarizationEnabled = false;
    }

    const result = await this.core.initAll(projectRoot, this.configDir);

    this.historyStore = new InputHistoryPersistence(projectRoot);

    const inputHistory = await this.historyStore.load();
    if (inputHistory.length > 0) {
      tuiState.setInputHistory(inputHistory);
      tuiState.setHistoryIndex(inputHistory.length);
    }

    // 加载上次对话 — 从 Core 查询 + 持久化补充
    const rootAgent = result.rootAgent;
    if (rootAgent) {
      await this.store.loadHistory(this.core, rootAgent);
      const coreCount = this.store.messages.length;

      // context 已由 Core 加载，直接使用
      if (coreCount > 0) {
        defaultLogger.info(`TuiBridge: Core has ${coreCount} msgs, using Core context`);
      }

      if (this.store.messages.length > 0) {
        this.store.syncTo(tuiState);
        const collapsed = this.store.getCollapsedThoughts();
        tuiState.setCollapsedThoughts(collapsed);
        defaultLogger.info(`TuiBridge: restored ${this.store.messages.length} messages for [${rootAgent}]`);
      } else {
        defaultLogger.info(`TuiBridge: no history for [${rootAgent}]`);
      }
    }

    this.setStatus('idle');

    const currentAgent = this.core.getCurrentAgent();
    if (currentAgent) {
      try {
        await this.core.startAgent(currentAgent);
        tuiState.setAgentCwd(this.getAgentCwd());
        defaultLogger.info(`TuiBridge: auto-started agent [${currentAgent}]`);
      } catch (err) {
        defaultLogger.warn(`TuiBridge: auto-start agent [${currentAgent}] failed: ${(err as Error).message}`);
      }
    }

    return result;
  }

  async dispose(): Promise<void> {
    defaultLogger.info('TuiBridge: disposing');
    await this.core.dispose();
    this.status = 'disconnected';
    this.loadedModules.clear();
  }

  // -----------------------------------------------------------------------
  // Agent 交互
  // -----------------------------------------------------------------------

  async sendMessage(_moduleName: string, text: string): Promise<{ result?: { reply: string }; error?: string }> {
    try {
      const targetType = tuiState.currentTarget();

      // 用户消息写入 store
      this.store.addUserMsg(text);
      this.store.syncTo(tuiState);

      // 开始流式会话
      this.store.startStream();

      // 路由到正确的子系统
      if (targetType === 'role') {
        const roleName = this.core.getCurrentAgent();
        if (!this.core.roles) throw new Error('Role subsystem not initialized');
        await this.core.roles.sendMessage(roleName, text);
      } else if (targetType === 'workflow') {
        const wfName = this.core.getCurrentAgent();
        if (!this.core.workflows) throw new Error('Workflow subsystem not initialized');
        await this.core.workflows.executeWorkflow(wfName, text);
      } else {
        const targetName = this.core.getCurrentAgent();
        if (targetName && !this.loadedModules.has(targetName)) {
          this.loadedModules.add(targetName);
        }
        await this.core.sendMessage(text);
      }

      this.autoSave();
    } catch (err) {
      this.store.addErrorMsg((err as Error).message);
      this.store.syncTo(tuiState);
      this._updateGlobalStatus();
      return { error: (err as Error).message };
    }
    return { result: { reply: '' } };
  }

  async cancelAgent(_moduleName: string): Promise<void> {
    return this.cancel();
  }

  async cancel(): Promise<void> {
    await this.core.cancel();
    this._updateGlobalStatus();
  }

  async clearContext(moduleName?: string): Promise<void> {
    await this.core.clearContext(moduleName);
    const name = moduleName || this.core.getCurrentAgent();
    if (name) {
      this.store.clear();
      this.store.syncTo(tuiState);
    }
  }

  /** 创建新会话：存档当前消息 → 清除 Core 上下文 → 清空 TUI 状态 */
  async newSession(moduleName?: string): Promise<void> {
    const name = moduleName || this.core.getCurrentAgent();
    if (!name) return;

    // 1. 清除 Core 上下文（sessionId 文件 + AgentStateManager + context 文件）
    await this.core.clearContext(name);

    // 2. 清空 TUI store
    this.store.clear();
    this.store.syncTo(tuiState);
    defaultLogger.info(`TuiBridge: new session started for [${name}]`);
  }

  async clearAllContexts(): Promise<void> {
    // 委托 Core 清理所有持久化上下文（AgentStateManager + sessionId + context 文件）
    await this.core.modules.clearAllContexts();
    this.store.clear();
    this.store.syncTo(tuiState);
    defaultLogger.info('TuiBridge: all contexts cleared');
  }

  // -----------------------------------------------------------------------
  // 查询
  // -----------------------------------------------------------------------

  getGraph(): ModuleGraphType | null {
    return this.core.getGraph();
  }

  getCurrentAgent(): string {
    return this.core.getCurrentAgent();
  }

  getAgentStatus(): AgentStatus {
    return this.status;
  }

  listAgents(): string[] {
    const graph = this.core.getGraph();
    if (!graph) return [];
    return [...graph.nodes.keys()];
  }

  isModuleLoaded(name: string): boolean {
    return this.loadedModules.has(name);
  }

  async setCurrentAgent(name: string): Promise<void> {
    const graph = this.core.getGraph();
    if (!graph) throw new Error('Not initialized');
    if (!graph.nodes.has(name)) throw new Error(`Module "${name}" not found`);

    await this.core.setCurrentAgent(name);
    tuiState.setCurrentAgent(name);
    this.loadedModules.add(name);
    tuiState.setAgentCwd(this.getAgentCwd());

    // 从 core 加载历史消息
    await this.store.loadHistory(this.core, name);
    this.store.syncTo(tuiState);
    const collapsed = this.store.getCollapsedThoughts();
    tuiState.setCollapsedThoughts(collapsed);

    try {
      await this.core.modules.startAgent(name);
      defaultLogger.info(`TuiBridge: agent [${name}] started eagerly`);
    } catch (err) {
      defaultLogger.warn(`TuiBridge: failed to start agent [${name}]: ${(err as Error).message}`);
    }
  }

  // -----------------------------------------------------------------------
  // 角色 Agent 管理
  // -----------------------------------------------------------------------

  async getRoleConfigs(): Promise<RoleConfigData[]> {
    const projectRoot = this.core.getProjectRoot();
    if (!projectRoot) return [];
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      return (workspaceConfig.roles || []).map(r => ({
        name: r.name,
        description: r.description,
        visibleModulePaths: r.visibleModulePaths,
        agents: { default: { command: r.agents.default.command || '', args: r.agents.default.args || [] } },
        knowledgeRefs: r.knowledgeRefs,
      }));
    } catch {
      return [];
    }
  }

  async startRole(roleName: string): Promise<void> {
    if (!this.core.roles) throw new Error('Role subsystem not initialized');
    const configs = await this.getRoleConfigs();
    const roleConfig = configs.find(r => r.name === roleName);
    if (!roleConfig) throw new Error(`Role "${roleName}" not found in config`);

    const rc: RoleConfig = {
      name: roleConfig.name,
      description: roleConfig.description,
      visibleModulePaths: roleConfig.visibleModulePaths,
      agents: { default: { command: roleConfig.agents.default.command || '', args: roleConfig.agents.default.args || [] } },
    };
    await this.core.roles.startRole(rc);
    tuiState.setCurrentAgent(roleName);
    tuiState.setCurrentTarget('role');
    this._updateActiveCounts();
    defaultLogger.info(`TuiBridge: started role agent [${roleName}]`);
  }

  async sendRoleMessage(roleName: string, text: string): Promise<void> {
    if (!this.core.roles) throw new Error('Role subsystem not initialized');
    await this.core.roles.sendMessage(roleName, text);
  }

  async cancelRole(roleName: string): Promise<void> {
    if (!this.core.roles) return;
    await this.core.roles.cancel(roleName);
  }

  async stopRole(roleName: string): Promise<void> {
    if (!this.core.roles) return;
    await this.core.roles.stopRole(roleName);
    this._updateActiveCounts();
  }

  listRunningRoles(): string[] {
    if (!this.core.roles) return [];
    return this.core.roles.listAgents();
  }

  getRoleStatus(name: string): AgentStatus {
    return this.core.roles?.getAgent(name) ? 'idle' : 'idle';
  }

  // -----------------------------------------------------------------------
  // 工作流管理
  // -----------------------------------------------------------------------

  listWorkflows(): string[] {
    if (!this.core.workflows) return [];
    return this.core.workflows.listWorkflows();
  }

  loadWorkflow(name: string): any {
    if (!this.core.workflows) return null;
    return this.core.workflows.loadWorkflow(name);
  }

  async executeWorkflow(name: string, userInput?: string): Promise<void> {
    if (!this.core.workflows) throw new Error('Workflow subsystem not initialized');
    tuiState.setCurrentAgent(name);
    tuiState.setCurrentTarget('workflow');
    this._updateActiveCounts();
    await this.core.workflows.executeWorkflow(name, userInput);
  }

  async cancelWorkflow(name: string): Promise<void> {
    if (!this.core.workflows) return;
    await this.core.workflows.cancel(name);
  }

  getWorkflowStatus(name: string) {
    if (!this.core.workflows) return null;
    return this.core.workflows.getExecutionState(name);
  }

  getCurrentWorkflow(): string | null {
    if (!this.core.workflows) return null;
    return this.core.workflows.getCurrentWorkflow();
  }

  // -----------------------------------------------------------------------
  // 多模块状态查询
  // -----------------------------------------------------------------------

  getModuleStatuses(): Map<string, AgentStatus> {
    const map = new Map<string, AgentStatus>();
    for (const { name, status } of this.core.modules.listAgentStatuses()) {
      map.set(name, status);
    }
    return map;
  }

  get loadedModulesSet(): Set<string> {
    return this.loadedModules;
  }

  getAgentCwd(): string {
    return this.core.getAgentCwd(this.core.getCurrentAgent()) || this.core.getProjectRoot();
  }

  getAgentModes(): { value: string; name: string; current: boolean }[] {
    return this.core.getAgentModes(this.core.getCurrentAgent());
  }

  async setAgentMode(modeValue: string): Promise<void> {
    await this.core.setAgentMode(this.core.getCurrentAgent(), modeValue);
  }

  async setGlobalDefaultMode(modeValue: string): Promise<void> {
    const projectRoot = this.core.getProjectRoot();
    const { ConfigLoader } = await import('../config/ConfigLoader.js');
    const workspace = await ConfigLoader.load(projectRoot);
    const defaultEntry = ConfigLoader.getDefaultConfig(workspace);
    defaultEntry.agents.default = { ...defaultEntry.agents.default, defaultMode: modeValue };
    await ConfigLoader.upsertEntry(projectRoot, defaultEntry);
    this.core.setDefaultMode(modeValue);
    const agents = this.core.getModuleNames();
    for (const name of agents) {
      try { await this.core.setAgentMode(name, modeValue); } catch (err) {
        defaultLogger.warn(`TuiBridge: setAgentMode [${name}]: ${(err as Error).message}`);
      }
    }
  }

  getAgentModels(): { value: string; name: string; current: boolean }[] {
    return this.core.getAgentModels(this.core.getCurrentAgent());
  }

  async setAgentModel(modelValue: string): Promise<void> {
    await this.core.setAgentModel(this.core.getCurrentAgent(), modelValue);
  }

  async setGlobalDefaultModel(modelValue: string): Promise<void> {
    const projectRoot = this.core.getProjectRoot();
    const { ConfigLoader } = await import('../config/ConfigLoader.js');
    const workspace = await ConfigLoader.load(projectRoot);
    const defaultEntry = ConfigLoader.getDefaultConfig(workspace);
    defaultEntry.agents.default = { ...defaultEntry.agents.default, model: modelValue };
    await ConfigLoader.upsertEntry(projectRoot, defaultEntry);
    const agents = this.core.getModuleNames();
    for (const name of agents) {
      try { await this.core.setAgentModel(name, modelValue); } catch (err) {
        defaultLogger.warn(`TuiBridge: setAgentModel [${name}]: ${(err as Error).message}`);
      }
    }
  }

  setTargetType(type: 'module' | 'role' | 'workflow'): void {
    tuiState.setCurrentTarget(type);
  }

  getTargetType(): string {
    return tuiState.currentTarget();
  }

  // -----------------------------------------------------------------------
  // 内部
  // -----------------------------------------------------------------------

  /** 从所有模块状态聚合全局状态：任意模块 streaming → streaming；任意 error → error；否则 idle */
  private _updateGlobalStatus(): void {
    const statuses = this.core.modules.listAgentStatuses();
    const hasStreaming = statuses.some(s => s.status === 'streaming');
    const hasError = statuses.some(s => s.status === 'error');
    const global: AgentStatus = hasStreaming ? 'streaming' : hasError ? 'error' : 'idle';
    this.status = global;
    tuiState.setAgentStatus(global);
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    tuiState.setAgentStatus(status);
  }

  // -----------------------------------------------------------------------
  // 持久化（兼容旧 API，后续可统一到 core）
  // -----------------------------------------------------------------------

  async saveSession(moduleName?: string): Promise<void> {
    const name = moduleName || this.core.getCurrentAgent();
    if (!name) return;
    const coreMsgs = this.store.formatForCore(this.store.messages);
    await this.core.modules.saveContext(name, coreMsgs);
    defaultLogger.info(`TuiBridge: session saved for [${name}] (${coreMsgs.length} msgs to context)`);
  }

  async loadSession(moduleName: string): Promise<ChatMessage[]> {
    const msgs = await this.core.modules.loadContext(moduleName);
    return this.store.formatFromCore(msgs);
  }

  /** 将加载的消息同步到 store（确保后续 Core 事件不覆盖） */
  setStoreMessages(msgs: ChatMessage[]): void {
    this.store.setMessages(msgs);
    this.store.syncTo(tuiState);
  }

  async listSessions(): Promise<string[]> {
    // 读取 context 目录下列出的文件名（去掉 .json 后缀）
    const projectRoot = this.core.getProjectRoot();
    const contextDir = path.join(projectRoot, '.module-agent', 'context');
    try {
      const files = await fs.readdir(contextDir);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async removeSession(moduleName: string): Promise<void> {
    await this.core.modules.clearModuleContext(moduleName);
  }

  public autoSave(): void {
    const name = this.core.getCurrentAgent();
    defaultLogger.info(`TuiBridge: autoSave — [${name}] ${this.store.messages.length} msgs`);
    this.saveSession(name).catch(err => defaultLogger.warn(`TuiBridge: autoSave error: ${(err as Error).message}`));
  }

  async saveInputHistory(history: string[]): Promise<void> {
    if (!this.historyStore) return;
    await this.historyStore.save(history);
  }

  private _updateActiveCounts(): void {
    tuiState.setActiveCounts({
      modules: this.loadedModules.size,
      roles: this.core.roles?.listAgents().length ?? 0,
      workflows: this.core.workflows?.getCurrentWorkflow() ? 1 : 0,
    });
  }
}
