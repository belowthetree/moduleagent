// ---------------------------------------------------------------------------
// core/ModuleAgentSubsystem.ts — 模块 Agent 子系统
// 管理模块 Agent 完整生命周期：初始化、扫描、启动、消息发送、跨模块通信
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';
import { KernelFactory, type AgentConfig } from '../agents/KernelFactory.js';
import { Agent } from '../agents/Agent.js';
import { SessionStore } from '../agents/StreamAccumulator.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { ModuleScanner } from './ModuleScanner.js';
import { ModuleGraph } from './ModuleGraph.js';
import { defaultLogger, type Logger } from './Logger.js';
import { AgentSandbox } from '../agents/kernel/Sandbox.js';
import {
  loadSystemPrompts,
  buildPromptBlocks,
  dedupMessage,
} from '../agents/prompts/PromptBuilder.js';
import { SendGuard } from './AgentSubsystemUtils.js';
import { normalizeCodeSourcePath } from './PathUtils.js';
import { withRetry } from './RetryPolicy.js';
import type { PromptBlock } from '../agents/kernel/types.js';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { CoreCallbacks, CoreStatus, CoreMessage, InitResult } from './CoreTypes.js';
import type { ChatMsg } from '../types/shared.js';

// ---------------------------------------------------------------------------
// AgentEntry 接口
// ---------------------------------------------------------------------------

export interface AgentEntry {
  agent: Agent;
  modulePath: string;
  /** 模块的源码目录（用于 workspace diff 对比） */
  sourcePath?: string;
}

// ---------------------------------------------------------------------------
// ModuleAgentSubsystem 选项
// ---------------------------------------------------------------------------

export interface ModuleAgentSubsystemOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  logger?: Logger;
  contextDir?: string;
  /** Optional external session-update listener (e.g. SessionStore in Electron) */
  onSessionUpdate?: (moduleName: string, sessionId: string, notification: any) => void;
  /** Optional cross-context notification callback (for UI) */
  onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
  /** Post-send hook: invoked after context save (for summarizer + workspace diff) */
  onPostSend?: (moduleName: string, msgs: ChatMsg[], entry: AgentEntry) => void;
  /** 忽略配置中的 projectPath，以 init 的 projectRoot 作为项目源码根目录（TUI 使用） */
  ignoreConfigProjectPath?: boolean;
}

// ---------------------------------------------------------------------------
// ModuleAgentSubsystem 核心类
// ---------------------------------------------------------------------------

export class ModuleAgentSubsystem {
  private callbacks: CoreCallbacks;
  private basePath: string;
  private configDir: string;
  private logger: Logger;
  private launcher = new KernelFactory();

  // 配置/图谱状态
  private projectRoot = '';
  private config: import('../config/defaults.js').ConfigEntry | null = null;
  private graph: ModuleGraphType | null = null;
  private prompts = { mainPrompt: '', subPrompt: '' };

  // Agent 状态
  private agents = new Map<string, AgentEntry>();
  private pendingStarts = new Map<string, Promise<AgentEntry>>();
  private currentModule = '';
  private sessionPrompted = new Set<string>();
  private lastSent = new Map<string, { text: string; time: number }>();
  private sendGuard = new SendGuard();
  private toolNameById = new Map<string, string>(); // toolCallId → 真实工具名

  // Agent 状态管理（流累积 + 上下文持久化）
  private _stateManager: SessionStore | null = null;

  // 每个模块的 Agent 运行状态
  private _agentStatus = new Map<string, 'idle' | 'streaming' | 'error'>();

  // 跨模块路由
  crossModuleRouter: import('../agents/mcp/McpBackend.js').CrossModuleRouter | null = null;

  /** 跨模块调用限制（供 Router 构造） */
  get crossModuleLimits(): { maxHops?: number; timeoutMs?: number } {
    return this.config?.crossModule ?? {};
  }

  // 外部钩子
  private _onSessionUpdate?: (moduleName: string, sessionId: string, notification: any) => void;
  private _onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
  private _onPostSend?: (moduleName: string, msgs: ChatMsg[], entry: AgentEntry) => void;
  private ignoreConfigProjectPath: boolean;

  constructor(options: ModuleAgentSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.basePath = options.basePath;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this.logger = options.logger || defaultLogger;
    this._onSessionUpdate = options.onSessionUpdate;
    this._onCrossContext = options.onCrossContext;
    this._onPostSend = options.onPostSend;
    this.ignoreConfigProjectPath = options.ignoreConfigProjectPath ?? false;
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  updateConfigDir(configDir: string): void {
    this.configDir = configDir;
  }

  async init(projectRoot: string): Promise<InitResult> {
    this.projectRoot = projectRoot;
    this.setStatus('loading');

    const workspaceConfig = await ConfigLoader.load(projectRoot);
    this.config = ConfigLoader.getDefaultConfig(workspaceConfig);
    if (this.ignoreConfigProjectPath) {
      this.config = { ...this.config, projectPath: projectRoot };
    }

    const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
    fs.ensureDirSync(moduleScanPath);
    const descriptors = await ModuleScanner.scan({
      projectRoot: moduleScanPath,
      extraExclude: this.config.exclude,
    });

    this.logger.info(`ModuleScanner: found ${descriptors.length} modules`);
    this.graph = new ModuleGraph().build(descriptors, projectRoot);

    this.prompts = loadSystemPrompts(this.configDir);
    this._stateManager = new SessionStore(
      path.join(projectRoot, '.module-agent', 'context'),
      { maxMessages: this.config.contextHistoryLimit },
    );
    this.currentModule = this.graph.root;

    this.setStatus('idle');

    return {
      moduleNames: [...this.graph.nodes.keys()],
      rootAgent: this.graph.root,
    };
  }

  async dispose(): Promise<void> {
    this.logger.info('ModuleAgentSubsystem: disposing');
    for (const [, entry] of this.agents) {
      entry.agent.stop();
    }
    this.agents.clear();
    this.pendingStarts.clear();
    this.sendGuard.clear();
    this.sessionPrompted.clear();
    this._agentStatus.clear();
  }

  // -----------------------------------------------------------------------
  // Agent 交互
  // -----------------------------------------------------------------------

  /** Send result returned by sendMessage */
  async sendMessage(
    text: string,
    moduleName?: string,
  ): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: unknown[]; stopReason?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }; error?: string }> {
    if (!this.graph) throw new Error('Not initialized — call init() first');

    const targetName = moduleName || this.currentModule;
    const routed = this._routeMessage(text);
    const finalTarget = routed.targetName || targetName;
    const finalText = routed.prompt || text;

    if (dedupMessage(this.lastSent, finalTarget, finalText)) {
      return { result: { reply: '', thinking: '', tools: '' } };
    }

    // 按模块发送互斥锁
    const release = await this.sendGuard.acquire(finalTarget);

    try {
      let entry = this.agents.get(finalTarget);
      if (!entry) {
        entry = await this.startAgent(finalTarget);
      }

      this.setAgentStatus(finalTarget, 'streaming');
      this.setStatus('streaming');

      // ── 开始流累积 ──
      this._stateManager?.startStream(finalTarget);

      const blocks = buildPromptBlocks({
        moduleName: finalTarget,
        userText: finalText,
        graph: this.graph,
        prompts: this.prompts,
        sessionPrompted: this.sessionPrompted,
        cwd: entry.agent.cwd,
        progressiveDisclosure: this.config?.progressiveDisclosure !== false,
      });

      this.logger.info(`sendMessage [${finalTarget}]: ${finalText.length} chars, ${blocks.length} blocks`);
      // 使用 agent.send() 而非 connection.prompt() 直调：
      // send() 内部 _processMessage → _transition(Idle) → _drainQueue()
      // 确保权限拒绝排队的系统消息能被发送给 agent
      await entry.agent.send(blocks);

      // ── 结束流累积 ──
      const acc = this._stateManager?.finishStream(finalTarget);

      this.callbacks.onStreamComplete(finalTarget);

      // ── 构建消息并持久化上下文 ──
      const timeStr = new Date().toLocaleTimeString();
      const userMsg: ChatMsg = {
        id: 'm' + Date.now().toString(36),
        role: 'user',
        content: finalText,
        thinking: '',
        time: timeStr,
        status: 'sent',
        moduleName: finalTarget,
        sessionId: entry.agent.sessionId,
      };
      const agentMsg: ChatMsg = {
        id: 'm' + (Date.now() + 1).toString(36),
        role: 'agent',
        content: acc?.reply || '',
        thinking: acc?.thinking || '',
        timeline: acc?.timeline || [],
        time: timeStr,
        status: 'completed',
        moduleName: finalTarget,
      };

      const existingMsgs = await this.loadContext(finalTarget);
      existingMsgs.push(userMsg, agentMsg);
      await this._stateManager?.saveContext(finalTarget, existingMsgs);

      // ── 后处理钩子（总结 + 工作区 diff） ──
      this._onPostSend?.(finalTarget, existingMsgs, entry);

      this.setAgentStatus(finalTarget, 'idle');
      this.setStatus('idle');

      if (entry.agent.lastUsage) {
        this.logger.info(
          `sendMessage [${finalTarget}] usage: prompt=${entry.agent.lastUsage.promptTokens} ` +
          `completion=${entry.agent.lastUsage.completionTokens} total=${entry.agent.lastUsage.totalTokens}`,
        );
      }

      return {
        result: {
          reply: acc?.reply || '',
          thinking: acc?.thinking || '',
          tools: acc?.tools || '',
          timeline: acc?.timeline || [],
          usage: entry.agent.lastUsage,
        },
      };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`sendMessage [${finalTarget}] failed: ${message}`);
      this._stateManager?.stopStream(finalTarget);
      this.callbacks.onStreamError(finalTarget, message);
      this.setAgentStatus(finalTarget, 'error');
      this.setStatus('error');
      return { error: message };
    } finally {
      release();
    }
  }

  async cancel(): Promise<void> {
    // 取消所有正在 stream 的 agent（不限于 currentModule，子模块也可能在流式输出）
    const streamingAgents: string[] = [];
    for (const [name, status] of this._agentStatus) {
      if (status === 'streaming') streamingAgents.push(name);
    }
    if (streamingAgents.length === 0) {
      this.logger.info('cancel: no streaming agents');
      return;
    }

    for (const name of streamingAgents) {
      const entry = this.agents.get(name);
      if (!entry) continue;
      try {
        // 只取消不删除：cancel() 会 abort 在途调用并以 Canceled 错误 reject 排队项，
        // agent 保持可复用（与 Electron 路径语义一致）
        await entry.agent.cancel();
        this.setAgentStatus(name, 'idle');
        this.logger.info(`cancel [${name}] → cancelled`);
      } catch (err) {
        this.logger.warn(`cancel [${name}] failed: ${(err as Error).message}`);
      }
    }
  }

  /** 清空当前模块的上下文（创建新会话 + 删除持久化消息） */
  async clearContext(moduleName?: string): Promise<void> {
    const name = moduleName || this.currentModule;
    const entry = this.agents.get(name);
    if (entry) {
      try {
        const newSessionId = await entry.agent.clearContext();
        this.logger.info(`clearContext: new session for [${name}], sessionId=${newSessionId}`);
      } catch (err) {
        // clearContext 失败回退：停止内核，下次使用时自动重启
        this.logger.warn(`clearContext: failed for [${name}], stopping agent: ${(err as Error).message}`);
        entry.agent.stop();
        this.agents.delete(name);
        this._agentStatus.delete(name);
      }
    } else {
      this.logger.info(`clearContext: agent not running, clearing persisted context for [${name}]`);
    }
    // 删除持久化的对话上下文文件（否则重启后 loadContext 又读回来）
    await this._stateManager?.clearContext(name);
    this.sessionPrompted.delete(name);
    this.lastSent.delete(name);
    this.toolNameById.clear();
    this.logger.info(`clearContext: done for [${name}]`);
  }

  async setCurrentAgent(name: string): Promise<void> {
    if (!this.graph) throw new Error('Not initialized');

    if (!this.graph.nodes.has(name)) {
      throw new Error(`Module "${name}" not found in graph`);
    }

    this.currentModule = name;
    this.logger.info(`switch agent → "${name}"`);

    // 若未运行则延迟启动
    if (!this.agents.has(name)) {
      await this.startAgent(name);
    }
  }

  // -----------------------------------------------------------------------
  // Agent 生命周期（为 McpBackend 暴露）
  // -----------------------------------------------------------------------

  async startAgent(moduleName: string): Promise<AgentEntry> {
    const existing = this.agents.get(moduleName);
    if (existing) return existing;

    const pending = this.pendingStarts.get(moduleName);
    if (pending) return pending;

    // 启动失败重试一次（重试前复查：可能已被并发调用者启动）
    const promise = withRetry(
      async () => {
        const now = this.agents.get(moduleName);
        if (now) return now;
        return this._startAgentInternal(moduleName);
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1000,
        shouldRetry: () => true,
        onRetry: (attempt, delayMs, err) =>
          this.logger.warn(
            `startAgent [${moduleName}] failed (attempt ${attempt}/2), retrying in ${delayMs}ms: ${(err as Error)?.message ?? err}`,
          ),
      },
    );
    this.pendingStarts.set(moduleName, promise);

    try {
      return await promise;
    } finally {
      this.pendingStarts.delete(moduleName);
    }
  }

  getAgent(name: string): AgentEntry | undefined {
    return this.agents.get(name);
  }

  // -----------------------------------------------------------------------
  // 查询
  // -----------------------------------------------------------------------

  getCurrentAgent(): string {
    return this.currentModule;
  }

  getGraph(): ModuleGraphType | null {
    return this.graph;
  }

  getConfig(): import('../config/defaults.js').ConfigEntry | null {
    return this.config;
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  getAgentCwd(moduleName: string): string | null {
    return this.agents.get(moduleName)?.agent.cwd ?? null;
  }

  /** 计算模块的 workspace cwd（无需 agent 运行） */
  getWorkspaceCwd(moduleName: string): string | null {
    const node = this.graph?.nodes.get(moduleName);
    if (!node) return null;
    // 根模块
    if (node.relativePath === '.') {
      return path.join(this.projectRoot, '.module-agent', 'module');
    }
    // 子模块：直接用源码路径
    return this._getSourcePath(moduleName) || node.absolutePath;
  }

  getAgentModes(moduleName: string): { value: string; name: string; current: boolean }[] {
    // 内核模式没有 agent 上报的 mode 列表，如实返回空
    return [];
  }

  /** 更新内存中的 defaultMode（新启动的 agent 会用到） */
  setDefaultMode(modeValue: string): void {
    if (this.config) {
      this.config.agents.default.defaultMode = modeValue;
    }
  }

  /** 内核模式不支持运行时 mode 切换，恒返回 false 并记录日志 */
  async setAgentMode(moduleName: string, modeValue: string): Promise<boolean> {
    const entry = this.agents.get(moduleName);
    if (!entry) throw new Error(`Agent ${moduleName} not running`);
    const applied = await entry.agent.setConfigOption('mode', modeValue);
    if (!applied) {
      this.logger.warn(`[${moduleName}] 内核模式不支持运行时 mode 切换（${modeValue} 未生效）`);
    }
    return applied;
  }

  getAgentModels(moduleName: string): { value: string; name: string; current: boolean }[] {
    // 内核模式没有 agent 上报的模型列表，如实返回空
    return [];
  }

  /** 内核模式不支持运行时 model 切换，恒返回 false 并记录日志 */
  async setAgentModel(moduleName: string, modelValue: string): Promise<boolean> {
    const entry = this.agents.get(moduleName);
    if (!entry) throw new Error(`Agent ${moduleName} not running`);
    const applied = await entry.agent.setConfigOption('model', modelValue);
    if (!applied) {
      this.logger.warn(`[${moduleName}] 内核模式不支持运行时 model 切换（${modelValue} 未生效）`);
    }
    return applied;
  }

  // -----------------------------------------------------------------------
  // 公共辅助方法（供 McpBackend 集成）
  // -----------------------------------------------------------------------

  resolveAgentConfig(moduleName: string): AgentConfig {
    if (!this.config) return {};

    const modules = this.config.agents.modules;
    const def = this.config.agents.default;
    if (modules && modules[moduleName]) {
      const mod = modules[moduleName]!;
      return {
        provider: mod.provider || def.provider,
        apiKey: mod.apiKey || def.apiKey,
        baseUrl: mod.baseUrl || def.baseUrl,
        model: mod.model || def.model,
        maxTokens: mod.maxTokens ?? def.maxTokens,
        fastModel: mod.fastModel || def.fastModel,
        contextWindow: mod.contextWindow ?? def.contextWindow,
        defaultMode: mod.defaultMode || def.defaultMode,
      };
    }
    return {
      provider: def.provider,
      apiKey: def.apiKey,
      baseUrl: def.baseUrl,
      model: def.model,
      maxTokens: def.maxTokens,
      fastModel: def.fastModel,
      contextWindow: def.contextWindow,
      defaultMode: def.defaultMode,
    };
  }

  buildPromptBlocksForModule(moduleName: string, text: string): PromptBlock[] {
    const entry = this.agents.get(moduleName);
    return buildPromptBlocks({
      moduleName,
      userText: text,
      graph: this.graph,
      prompts: this.prompts,
      sessionPrompted: this.sessionPrompted,
      cwd: entry?.agent.cwd,
      progressiveDisclosure: this.config?.progressiveDisclosure !== false,
    });
  }

  hasPromptedModule(moduleName: string): boolean {
    return this.sessionPrompted.has(moduleName);
  }

  // -----------------------------------------------------------------------
  // Stream & context API（委托给 SessionStore）
  // -----------------------------------------------------------------------

  /** 获取 SessionStore 实例（供外部消费者如 bridge 使用） */
  get stateManager(): SessionStore | null {
    return this._stateManager;
  }

  // ── Agent 状态追踪 ──

  getAgentStatus(moduleName: string): 'idle' | 'streaming' | 'error' {
    return this._agentStatus.get(moduleName) || 'idle';
  }

  setAgentStatus(moduleName: string, status: 'idle' | 'streaming' | 'error'): void {
    this._agentStatus.set(moduleName, status);
    this.callbacks.onModuleStatusChange?.(moduleName, status);
  }

  deleteAgentStatus(moduleName: string): void {
    this._agentStatus.delete(moduleName);
  }

  listAgentStatuses(): Array<{ name: string; status: 'idle' | 'streaming' | 'error' }> {
    return [...this._agentStatus.entries()].map(([name, status]) => ({ name, status }));
  }

  startStream(moduleName: string): void {
    this._stateManager?.startStream(moduleName);
  }

  finishStream(moduleName: string) {
    return this._stateManager?.finishStream(moduleName);
  }

  cancelStream(moduleName: string) {
    return this._stateManager?.cancelStream(moduleName);
  }

  stopStream(moduleName: string): void {
    this._stateManager?.stopStream(moduleName);
  }

  getStreamState(moduleName: string) {
    return this._stateManager?.getStreamState(moduleName);
  }

  getModuleListForBridge(requestingModule: string): { name: string; description: string; path: string }[] {
    if (!this.graph) return [];
    const root = this.graph.root;
    const accessible = requestingModule && requestingModule !== root
      ? this._getAccessibleModules(requestingModule)
      : null;
    const result: { name: string; description: string; path: string }[] = [];
    for (const [name, node] of this.graph.nodes) {
      if (accessible && !accessible.has(name)) continue;
      result.push({
        name,
        description: node.definition.frontmatter.description,
        path: node.relativePath,
      });
    }
    return result;
  }

  private _getAccessibleModules(moduleName: string): Set<string> {
    const accessible = new Set<string>();
    if (!this.graph) return accessible;
    const node = this.graph.nodes.get(moduleName);
    if (!node) return accessible;
    accessible.add(moduleName);
    for (const child of node.children) accessible.add(child);
    if (node.parent) accessible.add(node.parent);
    return accessible;
  }

  async loadContext(moduleName: string): Promise<import('../types/shared.js').ChatMsg[]> {
    return this._stateManager?.loadContext(moduleName) ?? [];
  }

  async saveContext(moduleName: string, msgs: import('../types/shared.js').ChatMsg[]): Promise<void> {
    await this._stateManager?.saveContext(moduleName, msgs);
  }

  /** 跨模块调用上下文落盘（委托 SessionStore.appendCrossContext，供 CrossModuleRouter 回调） */
  async appendCrossContext(moduleName: string, requestText: string, responseText: string): Promise<void> {
    await this._stateManager?.appendCrossContext(moduleName, requestText, responseText);
  }

  /** 清空模块上下文（委托给 clearContext 完成完整清理） */
  async clearModuleContext(moduleName: string): Promise<void> {
    this.logger.info(`clearModuleContext [${moduleName}] → delegating to clearContext`);
    await this.clearContext(moduleName);
  }

  async clearAllContexts(): Promise<void> {
    // 1. 运行中的 agent：逐个完整清理（内核上下文重置 + 持久化文件删除）
    for (const name of [...this.agents.keys()]) {
      await this.clearContext(name);
    }

    // 2. 清理残留的 context 文件（已停止的 agent）
    await this._stateManager?.clearAllContexts();
    this.logger.info('clearAllContexts: all agents + files cleared');
  }

  // -----------------------------------------------------------------------
  // 内部：启动管道
  // -----------------------------------------------------------------------

  /** 计算模块的真实源码目录 */
  private _getSourcePath(moduleName: string): string | null {
    const node = this.graph?.nodes.get(moduleName);
    if (!node || !this.config?.projectPath) return null;
    // normalizeCodeSourcePath：防非 Windows 平台把 Windows 盘符路径当相对路径解析
    return node.relativePath === '.'
      ? normalizeCodeSourcePath(this.config.projectPath)
      : normalizeCodeSourcePath(path.join(this.config.projectPath, node.relativePath));
  }

  private async _startAgentInternal(moduleName: string): Promise<AgentEntry> {
    try {
      const agentConfig = this.resolveAgentConfig(moduleName);
      const node = this.graph?.nodes.get(moduleName) ?? null;

      // 计算 cwd + visibility
      const projectPath = this.config?.projectPath || '';
      const isRoot = node?.relativePath === '.';

      const sourcePath = projectPath && node
        ? this._getSourcePath(moduleName)!
        : (node?.absolutePath || this.projectRoot);

      const cwd = isRoot
        ? path.join(this.projectRoot, '.module-agent', 'module')
        : sourcePath;

      // visiblePaths: 自身 + 直接子模块
      // 根模块：仅限定 .module-agent/module/ 目录，不可访问项目源码
      const allowed = isRoot
        ? [path.join(this.projectRoot, '.module-agent', 'module')]
        : [path.resolve(sourcePath)];

      const excluded = (!isRoot && node && this.graph)
        ? node.children
            .map((childName: string) => this.graph!.nodes.get(childName))
            .filter((c: any) => !!c)
            .map((c: any) => this._getSourcePath(c.name))
            .filter((p: any): p is string => !!p)
        : [];

      const sandbox = new AgentSandbox({ allowed, excluded });

      this.logger.info(
        `startAgent [${moduleName}] cwd=${cwd} allowed=[${allowed.join(', ')}] excluded=[${excluded.join(', ')}]`,
      );

      // 构建 onNotification 回调（将通知分发给 CoreCallbacks + 外部监听器）
      const self = this;
      const onNotification = (sessionId: string, notification: any): void => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;

        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(moduleName, block.text, 'message');
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(moduleName, block.text, 'thought');
        } else if (update === 'tool_call') {
          self.logger.info(`[${moduleName}] tool_call: ${(data as { title?: string }).title || 'unknown'} ${formatNotificationForLog(notification)}`);
          const tc = data as { title?: string; status?: string; name?: string; toolName?: string; toolCallId?: string; input?: Record<string, unknown>; arguments?: Record<string, unknown>; params?: Record<string, unknown>; toolCall?: Record<string, unknown> };
          const toolName = tc.title || tc.toolName || tc.name || 'unknown';
          const toolStatus = tc.status || 'running';
          if (tc.toolCallId && tc.title) self.toolNameById.set(tc.toolCallId, tc.title);
          const toolInput = tc.input || tc.arguments || tc.params || tc.toolCall;
          const detail = toolInput ? JSON.stringify(toolInput).slice(0, 200) : undefined;
          self.callbacks.onToolCall?.(moduleName, toolName, toolStatus, detail, tc.toolCallId);
          if (tc.status === 'error') {
            self.setAgentStatus(moduleName, 'error');
            self.callbacks.onStreamError(moduleName, `Tool call failed: ${toolName}`);
          }
        } else if (update === 'tool_call_update') {
          const tc = data as { title?: string; status?: string; toolCallId?: string; toolName?: string; name?: string; rawInput?: Record<string, unknown> };
          const realName = (tc.toolCallId && self.toolNameById.get(tc.toolCallId)) || tc.toolName || tc.title || tc.name || 'unknown';
          if (tc.status) {
            self.callbacks.onToolCall?.(moduleName, realName, tc.status, undefined, tc.toolCallId);
          }
        } else if (update === 'context_usage') {
          const u = (data as { detail?: { tokens: number; window: number; ratio: number } }).detail;
          if (u) {
            self.callbacks.onMessage({
              id: `ctx-${Date.now()}`,
              role: 'system',
              content: `上下文已使用 ${(u.ratio * 100).toFixed(0)}%（约 ${u.tokens.toLocaleString()}/${u.window.toLocaleString()} tokens）。达到阈值时将自动精简历史。`,
              time: new Date().toLocaleTimeString(),
              moduleName,
            });
          }
        }

        // 流累积：将通知路由到 SessionStore
        if (update) {
          self._stateManager?.appendChunk(moduleName, update, data);
        }

        if (self._onSessionUpdate) {
          self._onSessionUpdate(moduleName, sessionId, notification);
        }
      };

      // 启动 Agent（systemPrompt 以独立 system 角色注入，锚定前缀缓存）
      const agent = await Agent.start({
        name: moduleName,
        config: agentConfig,
        cwd,
        launcher: this.launcher,
        logger: this.logger,
        sandbox,
        isRoot,
        onNotification,
        crossModuleRouter: this.crossModuleRouter ?? undefined,
        kernelModuleName: moduleName,
        systemPrompt: isRoot ? this.prompts.mainPrompt : this.prompts.subPrompt,
        moduleDir: path.join(this.projectRoot, '.module-agent', 'module', moduleName),
        truncation: this.config?.truncation,
        compaction: this.config?.compaction,
        archiveDir: path.join(
          this.projectRoot, '.module-agent', 'archives',
          moduleName.replace(/[<>:"/\\|?*]/g, '_'),
        ),
        onQueue: (qlen: number) => {
          self.callbacks.onMessage({
            id: `queue-${Date.now()}`,
            role: 'system',
            content: `Agent 正在工作中，您的输入已加入队列（第 ${qlen} 位）。`,
            time: new Date().toLocaleTimeString(),
            moduleName,
          });
        },
        onSystemMessage: (text: string, qlen: number) => {
          // 系统消息（如 permission 拒绝）排队时立即加入对话列表
          self.callbacks.onMessage({
            id: `sys-${Date.now()}`,
            role: 'system',
            content: text,
            time: new Date().toLocaleTimeString(),
            moduleName,
          });
          self.logger.info(
            `[${moduleName}] system message queued (queue=${qlen}): ${text.slice(0, 80)}`,
          );
        },
      });

      this.sessionPrompted.delete(moduleName);

      const entry: AgentEntry = {
        agent,
        modulePath: cwd,
        sourcePath: node && projectPath
          ? this._getSourcePath(moduleName) || cwd
          : cwd,
      };
      this.agents.set(moduleName, entry);

      this.logger.info(`startAgent [${moduleName}] ready, sessionId=${agent.sessionId}`);
      this.setAgentStatus(moduleName, 'idle');
      return entry;
    } catch (err) {
      this.logger.error(`startAgent [${moduleName}] failed: ${(err as Error).message}`);
      this.setAgentStatus(moduleName, 'error');
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // 消息路由（从 AgentRouter 而来）
  // -----------------------------------------------------------------------

  private _routeMessage(message: string): { targetName: string | null; prompt: string } {
    // 关键词匹配：@moduleName 或 模块: name
    const keyword = this._extractModuleKeyword(message);
    if (keyword) {
      const found = this._findModule(keyword);
      // 目标模块存在即路由（未启动时由 sendMessage 自动 startAgent），不再静默降级到当前模块
      if (found && this.graph?.nodes.has(found.name)) {
        if (found.fuzzy) {
          // 模糊命中：给用户可见提示，避免"以为发给 A 实际发给 B"
          this.callbacks.onMessage({
            id: `route-${Date.now()}`,
            role: 'system',
            content: `未找到精确匹配的模块「${keyword}」，已按模糊匹配路由到「${found.name}」。`,
            time: new Date().toLocaleTimeString(),
          });
        }
        return { targetName: found.name, prompt: message };
      }
    }

    // 文件路径匹配
    const pathMatch = this._extractFilePath(message);
    if (pathMatch) {
      const target = this._findModuleByFile(pathMatch);
      if (target && target !== this.graph?.root && this.graph?.nodes.has(target)) {
        return { targetName: target, prompt: message };
      }
    }

    // 默认：停留在当前 Agent
    return { targetName: null, prompt: message };
  }

  private _extractModuleKeyword(message: string): string | null {
    const match = message.match(/^@(\w[\w-]*)\b/);
    if (match) return match[1]!;
    const moduleMatch = message.match(/模块\s*[:：]\s*(\w[\w-]*)/);
    if (moduleMatch) return moduleMatch[1]!;
    const toMatch = message.match(/交给\s*(\w[\w-]*)\s*(模块|agent)?/);
    if (toMatch) return toMatch[1]!;
    return null;
  }

  private _extractFilePath(message: string): string | null {
    const match = message.match(/(?:^|\s)([a-zA-Z0-9_/.-]+\.[a-zA-Z]+)(?:\s|$)/);
    return match ? match[1]! : null;
  }

  /** 按关键词查找模块：精确匹配优先，模糊（includes）命中时标记 fuzzy 供调用方提示用户 */
  private _findModule(keyword: string): { name: string; fuzzy: boolean } | undefined {
    const lower = keyword.toLowerCase();
    for (const [name] of this.graph?.nodes || []) {
      if (name.toLowerCase() === lower) return { name, fuzzy: false };
    }
    for (const [name] of this.graph?.nodes || []) {
      if (name.toLowerCase().includes(lower)) return { name, fuzzy: true };
    }
    return undefined;
  }

  private _findModuleByFile(filePath: string): string | undefined {
    for (const [, node] of this.graph?.nodes || []) {
      if (filePath.startsWith(node.relativePath) || filePath.includes(node.relativePath)) {
        return node.name;
      }
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // 内部辅助方法
  // -----------------------------------------------------------------------

  private setStatus(status: CoreStatus): void {
    this.callbacks.onStatusChange(status);
  }
}

// ---------------------------------------------------------------------------
// 日志脱敏 + 截断（tool_call 通知可能含工具输入 = 文件内容 / 密钥）
// ---------------------------------------------------------------------------

/** 敏感参数键名（值在日志中替换为 ***） */
const SENSITIVE_KEY = /api[-_]?key|token|secret|password/i;
/** 通知日志序列化的最大长度 */
const NOTIFICATION_LOG_MAX_CHARS = 500;

/** 递归脱敏：敏感键的值替换为 ***（限制深度防止过深遍历） */
function maskSensitiveForLog(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.map((v) => maskSensitiveForLog(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '***' : maskSensitiveForLog(v, depth + 1);
  }
  return out;
}

/** 通知日志序列化：脱敏 + 截断（避免完整工具输入写入日志） */
function formatNotificationForLog(notification: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(maskSensitiveForLog(notification));
  } catch {
    json = String(notification);
  }
  return json.length > NOTIFICATION_LOG_MAX_CHARS
    ? json.slice(0, NOTIFICATION_LOG_MAX_CHARS) + '…'
    : json;
}
