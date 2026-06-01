// ---------------------------------------------------------------------------
// tui/bridge.ts — TuiBridge：TUI 模式 Core 桥接层
// 将 CoreCallbacks 翻译为 SolidJS 信号，管理模块/角色/工作流子系统的生命周期
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
import type { ChatMsg, RoleConfigData } from '../types/shared.js';
import type { RoleConfig } from '../config/defaults.js';
import { tuiState } from './state.js';
import { TuiPersistence, InputHistoryPersistence } from './persistence.js';
import { getProjectConfigDir, ensureConfigFiles } from '../core/ConfigPaths.js';
import * as WorkspaceDiff from '../core/WorkspaceDiff.js';
import type { DiffSummary } from '../types/shared.js';

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

  // 每个模块独立的消息存储
  private moduleMessages = new Map<string, ChatMessage[]>();

  // 每个模块的流式消息 ID 跟踪
  private moduleStreamState = new Map<string, { replyId: string | null; thoughtId: string | null }>();

  // 持久化
  private persistence: TuiPersistence | null = null;
  private historyStore: InputHistoryPersistence | null = null;

  // 工作区 Diff
  private diffCache = new Map<string, DiffSummary>();

  // 便捷：当前模块的消息列表
  private get currentMsgs(): ChatMessage[] {
    const name = this.core.getCurrentAgent() || 'main';
    if (!this.moduleMessages.has(name)) this.moduleMessages.set(name, []);
    return this.moduleMessages.get(name)!;
  }

  // 便捷：当前模块的流式 ID
  private get currentReplyMsgId(): string | null {
    return this.moduleStreamState.get(this.core.getCurrentAgent())?.replyId ?? null;
  }
  private set currentReplyMsgId(id: string | null) {
    const name = this.core.getCurrentAgent();
    const s = this.moduleStreamState.get(name) || { replyId: null, thoughtId: null };
    s.replyId = id;
    this.moduleStreamState.set(name, s);
  }
  private get currentThoughtMsgId(): string | null {
    return this.moduleStreamState.get(this.core.getCurrentAgent())?.thoughtId ?? null;
  }
  private set currentThoughtMsgId(id: string | null) {
    const name = this.core.getCurrentAgent();
    const s = this.moduleStreamState.get(name) || { replyId: null, thoughtId: null };
    s.thoughtId = id;
    this.moduleStreamState.set(name, s);
  }

  /** 将当前模块的消息同步到 tuiState（触发 UI 更新） */
  private syncMessages(): void {
    tuiState.setMessages([...this.currentMsgs]);
  }

  constructor() {
    this.summarizer = new ExperienceSummarizer(defaultLogger);
    // configDir 在 init() 中按 projectRoot 重新设置
    this.configDir = '';

    const self = this;
    const callbacks: CoreCallbacks = {
      onStreamChunk: (moduleName, text, type) => {
        if (type === 'message') {
          self.appendToStreamMsg(self.currentReplyMsgId, text, 'agent_reply', moduleName);
        } else if (type === 'thought') {
          self.appendToStreamMsg(self.currentThoughtMsgId, text, 'agent_thought', moduleName);
        }
      },
      onStreamComplete: (moduleName) => {
        self.finalizeStreamMsg(self.currentReplyMsgId);
        self.finalizeStreamMsg(self.currentThoughtMsgId);

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

        // 更新 cwd（agent 启动后 workspace 路径才确定）
        tuiState.setAgentCwd(self.getAgentCwd());

        // 触发工作区变更检测（后台异步）
        setImmediate(() => self._triggerWorkspaceDiff(moduleName));
      },
      onStreamError: (moduleName, error) => {
        self.setStatus('error');
        self.moduleStatuses.set(moduleName, 'error');
        self.currentMsgs.push({
          id: `err-${Date.now()}`, role: 'system', msgType: 'system',
          content: `Error: ${error}`, time: new Date().toLocaleTimeString(),
        });
        self.syncMessages();
      },
      onStatusChange: (status: CoreStatus) => {
        self.setStatus(status);
      },
      onMessage: (message: CoreMessage) => {
        self.currentMsgs.push({
          ...message,
          msgType: message.role === 'system' ? 'system' : 'agent_reply',
        });
        self.syncMessages();
      },
      onToolCall: (moduleName, toolName, toolStatus, toolDetail) => {
        // 仅在新工具启动时切分回复块；状态更新不切分
        const isNewTool = toolStatus === 'running' || toolStatus === 'pending';
        if (isNewTool) {
          self.finalizeStreamMsg(self.currentReplyMsgId);
          self.finalizeStreamMsg(self.currentThoughtMsgId);
          self.currentReplyMsgId = `reply-${Date.now()}`;
          self.currentThoughtMsgId = `thought-${Date.now()}`;
        }

        defaultLogger.info(`[TUI] onToolCall: module=${moduleName} tool=${toolName} status=${toolStatus} detail=${toolDetail || '(none)'}`);

        // 过滤明显异常的工具名（来自 tool_call_update 的脏数据）
        if (toolName.startsWith('private ') || toolName.includes('(') || toolName.length > 60) {
          defaultLogger.warn(`[TUI] onToolCall: skipping malformed tool name: ${toolName}`);
          return;
        }

        // 确保目标模块有消息列表
        if (!self.moduleMessages.has(moduleName)) self.moduleMessages.set(moduleName, []);

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

        // 跨模块工具（module_call / module_query）无详情时跳过，由 sendCrossContext 提供完整信息
        const isCrossModule = displayName === 'module_call' || displayName === 'module_query';
        if (isCrossModule && !extra) {
          return;
        }

        // 工具消息：进行中（`…`）→ 新建，已完成/错误（✓✗）→ 更新最近一条进行中消息
        const inFlight = statusIcon === '…';
        const msgs = self.moduleMessages.get(moduleName) || [];
        if (inFlight) {
          // 新建或替换同一工具的上一条进行中消息
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
              id: `tool-${moduleName}-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'system', msgType: 'tool_call',
              content, time: new Date().toLocaleTimeString(),
            });
          }
        } else {
          // completed/error：更新最近一条进行中消息，保留旧消息的 extra（tool_call_update 可能无 detail）
          let updated = false;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m && m.msgType === 'tool_call' && m.content.startsWith('…') && m.content.includes(displayName)) {
              // 如果新内容比旧内容更短（例如 tool_call_update 无 detail），保留旧 extra
              m.content = content.length >= m.content.length ? content : m.content.replace(/^…/, statusIcon);
              updated = true;
              break;
            }
          }
          if (!updated) {
            msgs.push({
              id: `tool-${moduleName}-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'system', msgType: 'tool_call',
              content, time: new Date().toLocaleTimeString(),
            });
          }
        }
        if (moduleName === self.core.getCurrentAgent()) self.syncMessages();
      },
      onCrossModuleMessage: (source, target, direction, phase, content) => {
        const shortContent = content.length > 100 ? content.slice(0, 100) + '…' : content;
        const statusIcon = phase === 'request' ? '…' : '✓';
        // sent → 目标; received ← 来源（target 始终是通信对方）
        const toolName = direction === 'sent' ? `→ ${target}` : `← ${target}`;
        const toolMsg: ChatMessage = {
          id: `cross-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system', msgType: 'tool_call',
          content: `${statusIcon} module_call ${toolName}: ${shortContent}`,
          time: new Date().toLocaleTimeString(),
        };
        // 按方向分配：McpBackend 约定 source 永远是消息归属模块
        //   sent:    source 发给 target → 归 source
        //   received: source 收到来自 target → 归 source
        const ownerModule = source;
        if (!self.moduleMessages.has(ownerModule)) self.moduleMessages.set(ownerModule, []);
        self.moduleMessages.get(ownerModule)!.push({ ...toolMsg });
        if (self.core.getCurrentAgent() === ownerModule) self.syncMessages();
      },
      onModuleStatusChange: (moduleName, status) => {
        self.moduleStatuses.set(moduleName, status);
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
          if (block?.text) self.appendToStreamMsg(self.currentReplyMsgId, block.text, 'agent_reply', roleName);
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentThoughtMsgId, block.text, 'agent_thought', roleName);
        }
      },
      onWorkflowSessionUpdate: (agentName, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;
        if (update) defaultLogger.info(`[ACP:wf] ${agentName} ← ${update}`);
        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentReplyMsgId, block.text, 'agent_reply', agentName);
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.appendToStreamMsg(self.currentThoughtMsgId, block.text, 'agent_thought', agentName);
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
    // 设置 configDir 指向项目的 .module-agent/config/
    const basePath = findRepoRoot();
    this.configDir = getProjectConfigDir(projectRoot);
    // 从仓库 config/ 复制到项目（如不存在）
    ensureConfigFiles(path.join(basePath, 'config'), projectRoot);

    const result = await this.core.initAll(projectRoot, this.configDir);

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
          this.moduleMessages.set(sessions[0]!, history);
          defaultLogger.info(`TuiBridge: first session [${sessions[0]}] has ${history.length} msgs`);
          if (history.length > 0) {
            defaultLogger.info(`TuiBridge: no history for [${rootAgent}], loaded [${sessions[0]}]`);
          }
        }
      }
      if (history.length > 0) {
        this.moduleMessages.set(rootAgent, history);
        this.syncMessages();
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

    // 自动启动根模块 agent
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

    // 初始检查所有模块的工作区变更（用 graph 而非 getModuleNames——后者只含已启动的 agent）
    const allNames = this.listAgents();
    for (const name of allNames) {
      this._triggerWorkspaceDiff(name);
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

      // 用户消息
      this.currentMsgs.push({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user', msgType: 'user', content: text,
        time: new Date().toLocaleTimeString(),
      });
      this.syncMessages();

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
      this.currentMsgs.push({
        id: `err-${Date.now()}`, role: 'system', msgType: 'system',
        content: `Send failed: ${(err as Error).message}`, time: new Date().toLocaleTimeString(),
      });
      this.syncMessages();
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
      this.moduleMessages.set(name, []);
      this.syncMessages();
      // 同时清除持久化的对话文件和 session 文件
      if (this.persistence) {
        await this.persistence.remove(name);
        defaultLogger.info(`TuiBridge: cleared persisted session [${name}]`);
      }
      // 删除 sessionId 记录（与 ModuleAgentSubsystem._sanitizeFileName 对齐）
      try {
        const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
        const sessionsDir = path.join(this.core.getProjectRoot(), '.module-agent', 'sessions');
        const sessionFile = path.join(sessionsDir, `${safeName}.json`);
        if (fs.existsSync(sessionFile)) {
          fs.unlinkSync(sessionFile);
          defaultLogger.info(`TuiBridge: removed sessionId file [${name}]`);
        }
      } catch (err) {
        defaultLogger.warn(`TuiBridge: failed to remove sessionId: ${(err as Error).message}`);
      }
    }
  }

  /** 清理所有 agent 的上下文 + 持久化文件 + session 记录 */
  async clearAllContexts(): Promise<void> {
    const agents = this.core.getModuleNames();
    defaultLogger.info(`TuiBridge: clearing all contexts for ${agents.length} agents`);
    for (const name of agents) {
      await this.core.clearContext(name); // 内部已处理 newSession + sessionId 文件
      this.moduleMessages.set(name, []);
      if (this.persistence) {
        await this.persistence.remove(name);
      }
    }
    // 清理不在 agent 列表中的残留持久化会话（含 sessionId 文件）
    if (this.persistence) {
      const allSessions = await this.persistence.list();
      for (const sess of allSessions) {
        if (!agents.includes(sess)) {
          await this.persistence.remove(sess);
        }
      }
    }
    // 清理 sessions 目录中不在 agent 列表里的残留 sessionId 文件
    try {
      const sessionsDir = path.join(this.core.getProjectRoot(), '.module-agent', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        const agentSessions = new Set(agents.map(n => n.replace(/[<>:"/\\|?*]/g, '_') + '.json'));
        for (const file of files) {
          if (file.endsWith('.json') && !agentSessions.has(file)) {
            fs.unlinkSync(path.join(sessionsDir, file));
          }
        }
      }
    } catch (err) {
      defaultLogger.warn(`TuiBridge: failed to clean sessions dir: ${(err as Error).message}`);
    }
    this.moduleMessages.clear();
    this.syncMessages();
    defaultLogger.info('TuiBridge: all contexts cleared');
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
    tuiState.setAgentCwd(this.getAgentCwd());

    // 加载该模块的历史对话
    if (this.persistence) {
      defaultLogger.info(`TuiBridge: loading history for switched module [${name}]`);
      // 合并持久化历史和内存中的消息（跨模块通信可能已写入）
      const persisted = await this.persistence.load(name);
      const inMemory = this.moduleMessages.get(name) || [];
      const merged = persisted.length >= inMemory.length ? persisted : inMemory;
      this.moduleMessages.set(name, merged);
      this.syncMessages();
      const collapsed = new Set<string>();
      for (const m of merged) {
        if (m.msgType === 'agent_thought' && m.content) collapsed.add(m.id);
      }
      tuiState.setCollapsedThoughts(collapsed);
      defaultLogger.info(`TuiBridge: [${name}] active msgs: ${merged.length}`);
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

  /** 获取当前 Agent 的工作目录 */
  getAgentCwd(): string {
    return this.core.getAgentCwd(this.core.getCurrentAgent()) || this.core.getProjectRoot();
  }

  getAgentModes(): { value: string; name: string; current: boolean }[] {
    return this.core.getAgentModes(this.core.getCurrentAgent());
  }

  async setAgentMode(modeValue: string): Promise<void> {
    await this.core.setAgentMode(this.core.getCurrentAgent(), modeValue);
  }

  /** 全局设置默认 mode：写配置 + 应用到所有运行中的 agent */
  async setGlobalDefaultMode(modeValue: string): Promise<void> {
    const projectRoot = this.core.getProjectRoot();

    // 1. 写入 .module-agent.json
    const { ConfigLoader } = await import('../config/ConfigLoader.js');
    const workspace = await ConfigLoader.load(projectRoot);
    const defaultEntry = ConfigLoader.getDefaultConfig(workspace);
    defaultEntry.agents.default = {
      ...defaultEntry.agents.default,
      defaultMode: modeValue,
    };
    await ConfigLoader.upsertEntry(projectRoot, defaultEntry);
    defaultLogger.info(`TuiBridge: set defaultMode=${modeValue} in config`);

    // 2. 更新内存中的 config（新启动的 agent 会用到）
    this.core.setDefaultMode(modeValue);

    // 3. 应用到所有运行中的 agent
    const agents = this.core.getModuleNames();
    for (const name of agents) {
      try {
        await this.core.setAgentMode(name, modeValue);
      } catch (err) {
        defaultLogger.warn(`TuiBridge: setAgentMode [${name}]: ${(err as Error).message}`);
      }
    }
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
  private appendToStreamMsg(msgId: string | null, text: string, msgType: MessageType, moduleName?: string): void {
    const targetModule = moduleName || this.core.getCurrentAgent();
    if (!this.moduleMessages.has(targetModule)) this.moduleMessages.set(targetModule, []);
    const msgs = this.moduleMessages.get(targetModule)!;

    // 如果没有 msgId，为该模块创建新的流式上下文
    const id = msgId || `${msgType}-${Date.now()}`;

    let idx = msgs.findIndex(m => m.id === id);
    if (idx === -1) {
      msgs.push({ id, role: 'agent', msgType, content: text, time: '' });
    } else {
      msgs[idx] = { ...msgs[idx]!, content: msgs[idx]!.content + text };
    }
    if (targetModule === this.core.getCurrentAgent()) this.syncMessages();
  }

  /** 标记流式消息完成（设置时间戳） */
  private finalizeStreamMsg(msgId: string | null): void {
    if (!msgId) return;
    const msgs = this.currentMsgs;
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    msgs[idx] = { ...msgs[idx]!, time: new Date().toLocaleTimeString() };
    this.syncMessages();
  }

  // -----------------------------------------------------------------------
  // 持久化
  // -----------------------------------------------------------------------

  /** 保存当前对话到磁盘 */
  async saveSession(moduleName?: string): Promise<void> {
    if (!this.persistence) return;
    const name = moduleName || this.core.getCurrentAgent();
    if (!name) return;
    const msgs = moduleName ? (this.moduleMessages.get(moduleName) || this.currentMsgs) : this.currentMsgs;
    await this.persistence.save(name, msgs);
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
    const name = this.core.getCurrentAgent();
    defaultLogger.info(`TuiBridge: autoSave — [${name}] ${this.currentMsgs.length} msgs`);
    this.saveSession(name).catch((err) => defaultLogger.warn(`TuiBridge: autoSave error: ${(err as Error).message}`));
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
      agentCwd: this.core.getAgentCwd(targetName) || undefined,
    }).catch(err => {
      defaultLogger.warn(`Summarizer error [${targetName}]: ${(err as Error).message}`);
    });
  }

  // -----------------------------------------------------------------------
  // 工作区 Diff
  // -----------------------------------------------------------------------

  _triggerWorkspaceDiff(moduleName: string): void {
    const projectRoot = this.core.getProjectRoot();
    const workspaceCwd = this.core.getAgentCwd(moduleName) || this.core.getWorkspaceCwd(moduleName);
    defaultLogger.info(`TuiBridge: _triggerWorkspaceDiff [${moduleName}] root=${projectRoot} cwd=${workspaceCwd}`);
    if (!workspaceCwd) { defaultLogger.info(`TuiBridge: diff skip [${moduleName}] — no cwd`); return; }
    if (!projectRoot) { defaultLogger.info(`TuiBridge: diff skip [${moduleName}] — no projectRoot`); return; }

    // 只处理 .module-agent/workspace/ 下的子模块（根模块 module/ 是源码本身，无需 diff）
    const workspaceBase = path.join(projectRoot, '.module-agent', 'workspace');
    if (!workspaceCwd.startsWith(workspaceBase + path.sep)) {
      defaultLogger.info(`TuiBridge: diff skip [${moduleName}] — cwd not in workspace: ${workspaceCwd}`);
      return;
    }

    const relPath = path.relative(workspaceBase, workspaceCwd);
    const sourceDir = relPath ? path.join(projectRoot, relPath) : projectRoot;

    // 跳过未初始化/空工作区
    if (!fs.existsSync(workspaceCwd)) {
      defaultLogger.info(`TuiBridge: diff skip [${moduleName}] — workspace dir missing`);
      return;
    }
    const gitAnchor = path.join(workspaceCwd, '.git');
    if (!fs.existsSync(gitAnchor)) {
      defaultLogger.info(`TuiBridge: diff skip [${moduleName}] — workspace not initialized (no .git)`);
      return;
    }

    // 收集子模块的排除路径（子模块目录在 workspace 拷贝时被排除，diff 时应跳过）
    const excludePaths: string[] = [];
    const graph = this.core.getGraph();
    if (graph) {
      const node = graph.nodes.get(moduleName);
      if (node) {
        // relPath 是当前模块相对 workspaceBase 的路径（如 "packages/agent"）
        // child.relativePath 是相对项目根的路径（如 "packages/agent/src"）
        // 需减去 relPath 前缀，得到相对 sourceDir 的路径（如 "src"）
        const prefix = relPath ? relPath.replace(/\\/g, '/') + '/' : '';
        for (const childName of node.children) {
          const child = graph.nodes.get(childName);
          if (child && child.relativePath !== '.') {
            const childRel = child.relativePath.replace(/\\/g, '/');
            if (prefix && childRel.startsWith(prefix)) {
              excludePaths.push(childRel.slice(prefix.length));
            } else {
              excludePaths.push(childRel);
            }
          }
        }
      }
    }

    try {
      defaultLogger.info(`TuiBridge: diff ${workspaceCwd} vs ${sourceDir}`);
      const summary = WorkspaceDiff.analyze(workspaceCwd, sourceDir, excludePaths);
      summary.moduleName = moduleName;
      this.diffCache.set(moduleName, summary);
      defaultLogger.info(`TuiBridge: diff [${moduleName}] files=${summary.files.length} +${summary.addedCount} ~${summary.modifiedCount} -${summary.deletedCount}`);

      if (summary.files.length > 0) {
        tuiState.setDiffPrompt(summary);
        defaultLogger.info(`TuiBridge: diff prompt set for [${moduleName}]`);
      }
    } catch (err) {
      defaultLogger.error(`TuiBridge: diff error [${moduleName}]: ${(err as Error).message}`);
    }
  }

  getWorkspaceDiff(moduleName?: string): DiffSummary | null {
    const name = moduleName || this.core.getCurrentAgent();
    return this.diffCache.get(name) ?? null;
  }

  getWorkspaceDiffFile(moduleName: string, filePath: string): string | null {
    const cached = this.diffCache.get(moduleName);
    if (!cached) return null;
    const file = cached.files.find(f => f.relativePath === filePath);
    if (!file) return null;
    return WorkspaceDiff.unifiedDiff(file.workspacePath, file.sourcePath);
  }

  async applyWorkspaceDiff(moduleName: string, files?: string[]): Promise<{ applied: number; errors: string[] }> {
    const cached = this.diffCache.get(moduleName);
    if (!cached) return { applied: 0, errors: ['no diff cache'] };
    const result = await WorkspaceDiff.apply(cached.workspaceDir, cached.sourceDir, files, cached.files);
    // 刷新缓存（传空 excludePaths——原分析已过滤）
    const newSummary = WorkspaceDiff.analyze(cached.workspaceDir, cached.sourceDir, []);
    newSummary.moduleName = moduleName;
    if (newSummary.files.length > 0) {
      this.diffCache.set(moduleName, newSummary);
      tuiState.setDiffPrompt(newSummary);
    } else {
      this.diffCache.delete(moduleName);
      tuiState.setDiffPrompt(null);
    }
    return result;
  }

  async discardWorkspaceDiff(moduleName: string): Promise<void> {
    const cached = this.diffCache.get(moduleName);
    if (!cached) return;
    await WorkspaceDiff.discardWorkspace(cached.workspaceDir);
    this.diffCache.delete(moduleName);
    tuiState.setDiffPrompt(null);
  }
}
