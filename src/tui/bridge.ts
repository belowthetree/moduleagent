import path from 'path';
import fs from 'fs-extra';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { defaultLogger } from '../core/Logger.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import type { AgentStatus, ChatMessage, MessageType } from './types.js';
import type { CoreCallbacks, CoreStatus, CoreMessage, InitResult, IAgentBridge } from '../core/CoreTypes.js';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { ChatMsg, RoleConfigData } from '../types/shared.js';
import type { RoleConfig } from '../config/defaults.js';
import { tuiState } from './state.js';
import { TuiPersistence, InputHistoryPersistence } from './persistence.js';

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
  private status: AgentStatus = 'idle';
  private loadedModules = new Set<string>();
  private summarizer: ExperienceSummarizer;
  private configDir: string;

  // 多模块/角色/工作流状态跟踪
  private moduleStatuses = new Map<string, AgentStatus>();
  private roleStatuses = new Map<string, AgentStatus>();

  // 流式消息 ID 跟踪 — 用于区分 reply 和 thought 追加
  private currentReplyMsgId: string | null = null;
  private currentThoughtMsgId: string | null = null;

  // 持久化
  private persistence: TuiPersistence | null = null;
  private historyStore: InputHistoryPersistence | null = null;

  constructor() {
    this.summarizer = new ExperienceSummarizer(defaultLogger);
    this.configDir = path.join(findRepoRoot(), 'config');

    const self = this;
    const callbacks: CoreCallbacks = {
      onStreamChunk: (moduleName, text, type) => {
        if (type === 'message') {
          self.appendToStreamMsg(self.currentReplyMsgId, text, 'agent_reply');
        } else if (type === 'thought') {
          self.appendToStreamMsg(self.currentThoughtMsgId, text, 'agent_thought');
        }
      },
      onStreamComplete: (moduleName) => {
        self.finalizeStreamMsg(self.currentReplyMsgId);
        self.finalizeStreamMsg(self.currentThoughtMsgId);

        // 自动折叠推理消息
        if (self.currentThoughtMsgId) {
          const set = new Set(tuiState.collapsedThoughts());
          set.add(self.currentThoughtMsgId);
          tuiState.setCollapsedThoughts(set);
        }

        self.currentReplyMsgId = null;
        self.currentThoughtMsgId = null;
        self.moduleStatuses.set(moduleName, 'idle');
        self.roleStatuses.set(moduleName, 'idle');
        self.setStatus('idle');
      },
      onStreamError: (moduleName, error) => {
        self.setStatus('error');
        self.moduleStatuses.set(moduleName, 'error');
        const msg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'system',
          msgType: 'system',
          content: `Error: ${error}`,
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      },
      onStatusChange: (status: CoreStatus) => {
        self.setStatus(status);
      },
      onMessage: (message: CoreMessage) => {
        const msg: ChatMessage = {
          ...message,
          msgType: message.role === 'system' ? 'system' : 'agent_reply',
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      },
      onToolCall: (moduleName, toolName, toolStatus, toolDetail) => {
        // 工具调用作为消息块边界：结束之前的消息块，新开后续消息块
        self.finalizeStreamMsg(self.currentReplyMsgId);
        self.finalizeStreamMsg(self.currentThoughtMsgId);
        self.currentReplyMsgId = `reply-${Date.now()}`;
        self.currentThoughtMsgId = `thought-${Date.now()}`;

        defaultLogger.info(`[TUI] onToolCall: module=${moduleName} tool=${toolName} status=${toolStatus} detail=${toolDetail || '(none)'}`);

        const statusIcon = toolStatus === 'completed' ? '✓' : toolStatus === 'error' ? '✗' : '…';
        // 清理工具名：module-agent_module_query → module_query
        const displayName = toolName.includes('_') ? toolName.replace(/^[^_]+_/, '') : toolName;

        // 解析工具参数，提取最重要的一两个字段
        let extra = '';
        try {
          if (toolDetail) {
            const detail = JSON.parse(toolDetail) as Record<string, unknown>;
            // 跨模块通信
            if (detail.targetModule) {
              extra = `→ ${detail.targetModule}`;
              const task = detail.task || detail.query;
              if (typeof task === 'string') extra += `: ${task.slice(0, 60)}`;
            } else if (detail.requestingModule) {
              extra = `← ${detail.requestingModule}`;
              const task = detail.task || detail.query;
              if (typeof task === 'string') extra += `: ${task.slice(0, 60)}`;
            } else {
              // 普通工具：提取文件路径或关键参数
              const path = detail.path || detail.filePath || detail.file || detail.directory;
              if (typeof path === 'string') {
                extra = path.length > 50 ? '…' + path.slice(-47) : path;
              } else {
                // 回退：显示第一个有意义的字符串值
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
        // 查找或创建工具消息
        const existingId = `tool-${moduleName}-${toolName}`;
        const msgs = tuiState.messages();
        const existing = msgs.find(m => m.id === existingId && m.msgType === 'tool_call');
        if (existing) {
          // 更新状态
          const updated = [...msgs];
          const idx = updated.indexOf(existing);
          updated[idx] = { ...existing, content };
          tuiState.setMessages(updated);
        } else {
          const toolMsg: ChatMessage = {
            id: existingId,
            role: 'system',
            msgType: 'tool_call',
            content,
            time: new Date().toLocaleTimeString(),
          };
          tuiState.setMessages([...msgs, toolMsg]);
        }
      },
    };

    const repoRoot = findRepoRoot();
    this.core = new ModuleAgentCore({
      callbacks,
      basePath: repoRoot,
      configDir: path.join(repoRoot, 'config'),
      logger: defaultLogger,
      onRoleSessionUpdate: (roleName, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;
        if (update) defaultLogger.info(`[ACP:role] ${roleName} ← ${update}`);
        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentReplyMsgId, block.text, 'agent_reply');
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentThoughtMsgId, block.text, 'agent_thought');
        }
      },
      onWorkflowSessionUpdate: (agentName, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;
        if (update) defaultLogger.info(`[ACP:wf] ${agentName} ← ${update}`);
        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentReplyMsgId, block.text, 'agent_reply');
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentThoughtMsgId, block.text, 'agent_thought');
        }
      },
      onCrossContext: (source, target, direction, phase, content) => {
        const arrow = direction === 'sent' ? '→' : '←';
        const label = phase === 'request' ? '请求' : '响应';
        const shortContent = content.length > 100 ? content.slice(0, 100) + '…' : content;
        const msg: ChatMessage = {
          id: `cross-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system',
          msgType: 'cross_context',
          content: `${arrow} ${source} → ${target} [${label}]: ${shortContent}`,
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      },
    });
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  async init(projectRoot: string): Promise<InitResult> {
    const result = await this.core.initAll(projectRoot);

    // 注入 TUI 特有的 MCP 回调（跨模块通知）
    try {
      const self = this;
      await this.core.startMcpBackend({
        sendCrossContext(source, target, direction, phase, content) {
          const arrow = direction === 'sent' ? '→' : '←';
          const label = phase === 'request' ? '请求' : '响应';
          const shortContent = content.length > 100 ? content.slice(0, 100) + '…' : content;
          tuiState.setMessages([...tuiState.messages(), {
            id: `cross-${Date.now()}`, role: 'system', msgType: 'cross_context',
            content: `${arrow} ${source} → ${target} [${label}]: ${shortContent}`,
            time: new Date().toLocaleTimeString(),
          }]);
        },
        setAgentStatus(moduleName, status) {
          self.moduleStatuses.set(moduleName, status);
        },
      });
    } catch (err) {
      defaultLogger.warn(`TuiBridge: MCP backend failed to start: ${(err as Error).message}`);
    }

    // 初始化持久化
    this.persistence = new TuiPersistence(projectRoot);
    this.historyStore = new InputHistoryPersistence(projectRoot);

    // 尝试加载输入历史
    const inputHistory = await this.historyStore.load();
    if (inputHistory.length > 0) {
      tuiState.setInputHistory(inputHistory);
      tuiState.setHistoryIndex(inputHistory.length);
    }

    // 尝试加载上次对话
    const rootAgent = result.rootAgent;
    if (rootAgent && this.persistence) {
      defaultLogger.info(`TuiBridge: looking for history — rootAgent=[${rootAgent}]`);
      let history = await this.persistence.load(rootAgent);
      defaultLogger.info(`TuiBridge: rootAgent history: ${history.length} msgs`);
      // 如果 rootAgent 无历史，尝试加载第一个已保存的模块
      if (history.length === 0) {
        const sessions = await this.persistence.list();
        defaultLogger.info(`TuiBridge: available sessions: [${sessions.join(', ')}]`);
        if (sessions.length > 0) {
          history = await this.persistence.load(sessions[0]!);
          defaultLogger.info(`TuiBridge: first session [${sessions[0]}] has ${history.length} msgs`);
          if (history.length > 0) {
            defaultLogger.info(`TuiBridge: no history for [${rootAgent}], loaded [${sessions[0]}]`);
          }
        }
      }
      if (history.length > 0) {
        tuiState.setMessages(history);
        const collapsed = new Set<string>();
        for (const m of history) {
          if (m.msgType === 'agent_thought' && m.content) {
            collapsed.add(m.id);
          }
        }
        tuiState.setCollapsedThoughts(collapsed);
        defaultLogger.info(`TuiBridge: restored ${history.length} messages for [${rootAgent}]`);
      }
    }

    this.setStatus('idle');
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

      // 用户消息
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        msgType: 'user',
        content: text,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), userMsg]);

      // 设置流式消息 ID（消息块在首次收到数据时按到达顺序创建）
      const now = Date.now();
      this.currentReplyMsgId = `reply-${now}`;
      this.currentThoughtMsgId = `thought-${now}`;

      // 路由到正确的子系统
      if (targetType === 'role') {
        const roleName = this.core.getCurrentAgent();
        if (!this.core.roles) throw new Error('Role subsystem not initialized');
        this.roleStatuses.set(roleName, 'streaming');
        await this.core.roles.sendMessage(roleName, text);
      } else if (targetType === 'workflow') {
        // 工作流模式下，消息发送给当前工作流步骤 agent
        const wfName = this.core.getCurrentAgent();
        if (!this.core.workflows) throw new Error('Workflow subsystem not initialized');
        await this.core.workflows.executeWorkflow(wfName, text);
      } else {
        const targetName = this.core.getCurrentAgent();
        if (targetName && !this.loadedModules.has(targetName)) {
          this.loadedModules.add(targetName);
        }
        this.moduleStatuses.set(targetName, 'streaming');
        await this.core.sendMessage(text);
      }

      // 触发即忘的经验总结（后台执行）
      const projectRoot = this.core.getProjectRoot();
      const targetName = this.core.getCurrentAgent();
      if (projectRoot && targetName) {
        this._triggerSummarizer(targetName, projectRoot);
      }

      // 自动保存对话（debounced）
      this.autoSave();
    } catch (err) {
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        msgType: 'system',
        content: `Send failed: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
      this.setStatus('error');
      return { error: (err as Error).message };
    }
    return { result: { reply: '' } };
  }

  async cancelAgent(_moduleName: string): Promise<void> {
    return this.cancel();
  }

  async cancel(): Promise<void> {
    await this.core.cancel();
    this.setStatus('idle');
  }

  async clearContext(moduleName?: string): Promise<void> {
    await this.core.clearContext(moduleName);
    const name = moduleName || this.core.getCurrentAgent();
    if (name) {
      tuiState.setMessages([]);
      // 同时清除持久化的对话文件和 session 文件
      if (this.persistence) {
        await this.persistence.remove(name);
        defaultLogger.info(`TuiBridge: cleared persisted session [${name}]`);
      }
      // 删除 sessionId 记录，下次启动将创建新会话
      try {
        const sessionsDir = path.join(this.core.getProjectRoot(), '.module-agent', 'sessions');
        const sessionFile = path.join(sessionsDir, `${name}.json`);
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
          defaultLogger.info(`TuiBridge: removed sessionId file [${name}]`);
        }
      } catch (err) {
        defaultLogger.warn(`TuiBridge: failed to remove sessionId: ${(err as Error).message}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 查询（用于 commands.ts）
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

    // 加载该模块的历史对话
    if (this.persistence) {
      defaultLogger.info(`TuiBridge: loading history for switched module [${name}]`);
      const history = await this.persistence.load(name);
      defaultLogger.info(`TuiBridge: [${name}] history: ${history.length} msgs`);
      if (history.length > 0) {
        tuiState.setMessages(history);
        const collapsed = new Set<string>();
        for (const m of history) {
          if (m.msgType === 'agent_thought' && m.content) {
            collapsed.add(m.id);
          }
        }
        tuiState.setCollapsedThoughts(collapsed);
        defaultLogger.info(`TuiBridge: loaded ${history.length} msgs for [${name}]`);
      } else {
        tuiState.setMessages([]);
        tuiState.setCollapsedThoughts(new Set());
      }
    }

    // 立即初始化 Agent（触发 session resume）
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

  /** 获取配置中定义的角色列表 */
  async getRoleConfigs(): Promise<RoleConfigData[]> {
    const projectRoot = this.core.getProjectRoot();
    if (!projectRoot) return [];
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      return (workspaceConfig.roles || []).map(r => ({
        name: r.name,
        description: r.description,
        visibleModulePaths: r.visibleModulePaths,
        agents: { default: { command: r.agents.default.command, args: r.agents.default.args } },
        knowledgeRefs: r.knowledgeRefs,
      }));
    } catch {
      return [];
    }
  }

  /** 启动角色 Agent */
  async startRole(roleName: string): Promise<void> {
    if (!this.core.roles) throw new Error('Role subsystem not initialized');
    const configs = await this.getRoleConfigs();
    const roleConfig = configs.find(r => r.name === roleName);
    if (!roleConfig) throw new Error(`Role "${roleName}" not found in config`);

    const rc: RoleConfig = {
      name: roleConfig.name,
      description: roleConfig.description,
      visibleModulePaths: roleConfig.visibleModulePaths,
      agents: { default: { command: roleConfig.agents.default.command, args: roleConfig.agents.default.args || [] } },
    };
    await this.core.roles.startRole(rc);
    this.roleStatuses.set(roleName, 'idle');
    tuiState.setCurrentAgent(roleName);
    tuiState.setCurrentTarget('role');
    this._updateActiveCounts();
    defaultLogger.info(`TuiBridge: started role agent [${roleName}]`);
  }

  /** 向角色 Agent 发送消息 */
  async sendRoleMessage(roleName: string, text: string): Promise<void> {
    if (!this.core.roles) throw new Error('Role subsystem not initialized');
    this.roleStatuses.set(roleName, 'streaming');
    await this.core.roles.sendMessage(roleName, text);
  }

  /** 取消角色 Agent 当前操作 */
  async cancelRole(roleName: string): Promise<void> {
    if (!this.core.roles) return;
    await this.core.roles.cancel(roleName);
    this.roleStatuses.set(roleName, 'idle');
  }

  /** 停止角色 Agent */
  async stopRole(roleName: string): Promise<void> {
    if (!this.core.roles) return;
    await this.core.roles.stopRole(roleName);
    this.roleStatuses.delete(roleName);
    this._updateActiveCounts();
  }

  /** 获取运行中的角色名称列表 */
  listRunningRoles(): string[] {
    return [...this.roleStatuses.keys()];
  }

  /** 获取角色状态 */
  getRoleStatus(name: string): AgentStatus {
    return this.roleStatuses.get(name) || 'idle';
  }

  // -----------------------------------------------------------------------
  // 工作流管理（完整实现）
  // -----------------------------------------------------------------------

  listWorkflows(): string[] {
    if (!this.core.workflows) return [];
    return this.core.workflows.listWorkflows();
  }

  /** 加载工作流详情 */
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

  /** 获取工作流执行状态 */
  getWorkflowStatus(name: string) {
    if (!this.core.workflows) return null;
    return this.core.workflows.getExecutionState(name);
  }

  /** 获取当前工作流名称 */
  getCurrentWorkflow(): string | null {
    if (!this.core.workflows) return null;
    return this.core.workflows.getCurrentWorkflow();
  }

  // -----------------------------------------------------------------------
  // 多模块状态查询
  // -----------------------------------------------------------------------

  /** 获取所有模块的状态映射（模块名 → 状态） */
  getModuleStatuses(): Map<string, AgentStatus> {
    return new Map(this.moduleStatuses);
  }

  /** 已加载的模块集合（供 ModuleTree 查询） */
  get loadedModulesSet(): Set<string> {
    return this.loadedModules;
  }

  /** 设置当前交互目标类型 */
  setTargetType(type: 'module' | 'role' | 'workflow'): void {
    tuiState.setCurrentTarget(type);
  }

  /** 获取当前目标类型 */
  getTargetType(): string {
    return tuiState.currentTarget();
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  private setStatus(status: AgentStatus): void {
    this.status = status;
    tuiState.setAgentStatus(status);
  }

  /** 追加文本到指定 ID 的流式消息，若消息不存在则按到达顺序创建 */
  private appendToStreamMsg(msgId: string | null, text: string, msgType: MessageType): void {
    if (!msgId) return;
    const msgs = tuiState.messages();
    let idx = msgs.findIndex(m => m.id === msgId);
    if (idx === -1) {
      // 首次到达 — 按时间顺序插入消息列表末尾
      const newMsg: ChatMessage = {
        id: msgId,
        role: 'agent',
        msgType,
        content: text,
        time: '',
      };
      tuiState.setMessages([...msgs, newMsg]);
      return;
    }
    const updated = [...msgs];
    updated[idx] = {
      ...updated[idx]!,
      content: updated[idx]!.content + text,
    };
    tuiState.setMessages(updated);
  }

  /** 标记流式消息完成（设置时间戳） */
  private finalizeStreamMsg(msgId: string | null): void {
    if (!msgId) return;
    const msgs = tuiState.messages();
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const updated = [...msgs];
    updated[idx] = {
      ...updated[idx]!,
      time: new Date().toLocaleTimeString(),
    };
    tuiState.setMessages(updated);
  }

  // -----------------------------------------------------------------------
  // 持久化
  // -----------------------------------------------------------------------

  /** 保存当前对话到磁盘 */
  async saveSession(moduleName?: string): Promise<void> {
    if (!this.persistence) return;
    const name = moduleName || this.core.getCurrentAgent();
    if (!name) return;
    await this.persistence.save(name, tuiState.messages());
    defaultLogger.info(`TuiBridge: session saved for [${name}]`);
  }

  /** 加载指定模块的对话历史 */
  async loadSession(moduleName: string): Promise<ChatMessage[]> {
    if (!this.persistence) return [];
    return this.persistence.load(moduleName);
  }

  /** 列出已保存的会话 */
  async listSessions(): Promise<string[]> {
    if (!this.persistence) return [];
    return this.persistence.list();
  }

  /** 删除会话 */
  async removeSession(moduleName: string): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.remove(moduleName);
  }

  /** 在每次对话完成后自动保存 */
  public autoSave(): void {
    defaultLogger.info(`TuiBridge: autoSave — [${this.core.getCurrentAgent()}] ${tuiState.messages().length} msgs`);
    this.saveSession().catch((err) => defaultLogger.warn(`TuiBridge: autoSave error: ${(err as Error).message}`));
  }

  /** 保存输入历史 */
  async saveInputHistory(history: string[]): Promise<void> {
    if (!this.historyStore) return;
    await this.historyStore.save(history);
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 更新活跃子系统计数 */
  private _updateActiveCounts(): void {
    tuiState.setActiveCounts({
      modules: this.loadedModules.size,
      roles: this.roleStatuses.size,
      workflows: this.core.workflows?.getCurrentWorkflow() ? 1 : 0,
    });
  }

  /** 触发经验总结器（后台执行） */
  private _triggerSummarizer(targetName: string, projectRoot: string): void {
    defaultLogger.info(`Triggering summarizer for [${targetName}]`);
    const msgs = tuiState.messages();
    const chatMsgs: ChatMsg[] = msgs.map(m => ({
      id: m.id,
      role: (m.role === 'agent' ? 'agent' : m.role === 'user' ? 'user' : 'system') as ChatMsg['role'],
      content: m.content || '',
      thinking: m.msgType === 'agent_thought' ? (m.content || '') : '',
      tools: '',
      time: m.time || '',
      status: 'completed',
      moduleName: targetName || '',
      agentCmd: '',
    }));
    this.summarizer.summarize({
      moduleName: targetName,
      chatMsgs,
      projectRoot,
      configDir: this.configDir,
      agentConfig: { command: 'opencode', args: ['acp'] },
    }).catch(err => {
      defaultLogger.warn(`Summarizer error [${targetName}]: ${(err as Error).message}`);
    });
  }
}
