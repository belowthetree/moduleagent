// ---------------------------------------------------------------------------
// core/ModuleAgentSubsystem.ts — 模块 Agent 子系统
// 管理模块 Agent 完整生命周期：初始化、扫描、启动、消息发送、跨模块通信
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { AgentLauncher, type LaunchedAgent, type AgentConfig } from '../agents/AgentLauncher.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { ModuleScanner } from './ModuleScanner.js';
import { ModuleGraph } from './ModuleGraph.js';
import { defaultLogger, type Logger } from './Logger.js';
import {
  writeMcpGraphFile,
  buildMcpServers,
} from '../agents/McpServerBuilder.js';
import {
  workspacePathForModule,
  codeSourcePathForModule,
  getSubModuleDirs,
  prepareModuleWorkspace,
} from '../agents/WorkspaceIsolator.js';
import {
  loadSystemPrompts,
  buildPromptBlocks,
  dedupMessage,
} from '../agents/PromptBuilder.js';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { AgentCapabilities, SessionNotification, ContentBlock } from '@agentclientprotocol/sdk';
import type { CoreCallbacks, CoreStatus, CoreMessage, InitResult } from './CoreTypes.js';

// ---------------------------------------------------------------------------
// AgentEntry 接口
// ---------------------------------------------------------------------------

export interface AgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  modulePath: string;
  capabilities?: AgentCapabilities;
  modeOptions?: { value: string; name: string }[];
  currentMode?: string;
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
  /** Optional external session-update listener (e.g. AgentStateManager in Electron) */
  onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void;
  /** Optional cross-context notification callback (for UI) */
  onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
}

// ---------------------------------------------------------------------------
// ModuleAgentSubsystem 核心类
// ---------------------------------------------------------------------------

export class ModuleAgentSubsystem {
  private callbacks: CoreCallbacks;
  private basePath: string;
  private configDir: string;
  private logger: Logger;
  private launcher = new AgentLauncher();

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
  private sendLock = new Map<string, Promise<void>>();
  private toolNameById = new Map<string, string>(); // toolCallId → 真实工具名

  // MCP 状态
  mcpBackendPort = 0;
  mcpGraphFile = '';

  // 外部钩子
  private _onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void;
  private _onCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;

  constructor(options: ModuleAgentSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.basePath = options.basePath;
    this.configDir = options.configDir || path.join(options.basePath, 'config');
    this.logger = options.logger || defaultLogger;
    this._onSessionUpdate = options.onSessionUpdate;
    this._onCrossContext = options.onCrossContext;
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

    const moduleScanPath = path.join(projectRoot, '.module-agent', 'module');
    fs.ensureDirSync(moduleScanPath);
    const descriptors = await ModuleScanner.scan({
      projectRoot: moduleScanPath,
      extraExclude: this.config.exclude,
    });

    this.logger.info(`ModuleScanner: found ${descriptors.length} modules`);
    this.graph = new ModuleGraph().build(descriptors, projectRoot);

    this.mcpGraphFile = writeMcpGraphFile(this.graph, os.tmpdir());
    this.prompts = loadSystemPrompts(this.configDir);
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
      try { entry.launched.process.kill(); } catch { /* 忽略 */ }
    }
    this.agents.clear();
    this.pendingStarts.clear();
    this.sendLock.clear();
    this.sessionPrompted.clear();
  }

  // -----------------------------------------------------------------------
  // Agent 交互
  // -----------------------------------------------------------------------

  async sendMessage(text: string, moduleName?: string): Promise<void> {
    if (!this.graph) throw new Error('Not initialized — call init() first');

    const targetName = moduleName || this.currentModule;
    const routed = this._routeMessage(text);
    const finalTarget = routed.targetName || targetName;
    const finalText = routed.prompt || text;

    if (dedupMessage(this.lastSent, finalTarget, finalText)) return;

    // 按模块发送互斥锁
    const prevLock = this.sendLock.get(finalTarget);
    if (prevLock) {
      try { await prevLock; } catch { /* 继续 */ }
    }
    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(r => { resolveLock = r; });
    this.sendLock.set(finalTarget, lockPromise);

    try {
      let entry = this.agents.get(finalTarget);
      if (!entry) {
        entry = await this.startAgent(finalTarget);
      }

      this.setStatus('streaming');

      const blocks = buildPromptBlocks({
        moduleName: finalTarget,
        userText: finalText,
        graph: this.graph,
        prompts: this.prompts,
        sessionPrompted: this.sessionPrompted,
      });

      this.logger.info(`sendMessage [${finalTarget}]: ${finalText.length} chars, ${blocks.length} blocks`);
      await entry.launched.connection.prompt({
        sessionId: entry.sessionId,
        prompt: blocks,
      });

      this.callbacks.onStreamComplete(finalTarget);
      this.setStatus('idle');
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`sendMessage [${finalTarget}] failed: ${message}`);
      this.callbacks.onStreamError(finalTarget, message);
      this.setStatus('error');
      this.callbacks.onMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Error: ${message}`,
        time: new Date().toLocaleTimeString(),
      });
    } finally {
      resolveLock();
      this.sendLock.delete(finalTarget);
    }
  }

  async cancel(): Promise<void> {
    const entry = this.agents.get(this.currentModule);
    if (!entry) return;

    try {
      await entry.launched.connection.cancel({ sessionId: entry.sessionId });
      this.logger.info(`cancel [${this.currentModule}]`);
    } catch {
      // 忽略
    }
  }

  /** 清空当前模块的上下文（停止 Agent 进程 + 清除会话标记） */
  async clearContext(moduleName?: string): Promise<void> {
    const name = moduleName || this.currentModule;
    const entry = this.agents.get(name);
    if (entry) {
      this._ensureGitAnchor(entry.launched.cwd);

      // 优先调用 newSession 创建新会话（不杀进程，agent 保持运行）
      try {
        const mcpServers = buildMcpServers({
          moduleName: name,
          basePath: this.basePath,
          backendPort: this.mcpBackendPort,
          graphFile: this.mcpGraphFile,
        });
        const result = await entry.launched.connection.newSession({ cwd: entry.launched.cwd, mcpServers });
        entry.sessionId = result.sessionId;
        this._saveSessionId(name, result.sessionId);
        this.logger.info(`clearContext: new session for [${name}], sessionId=${result.sessionId}`);

        // 恢复 mode/model 配置
        await this._applySessionConfig(name, entry.config, entry.launched.connection, result.sessionId, result);
      } catch (err) {
        // newSession 失败回退：杀进程，下次使用时自动重启
        this.logger.warn(`clearContext: newSession failed for [${name}], killing process: ${(err as Error).message}`);
        try { entry.launched.process.kill(); } catch { /* ignore */ }
        this.agents.delete(name);
        this._deleteSessionId(name);
      }
    } else {
      // agent 未运行：只清理 sessionId 文件，防止下次启动时 resume
      this._deleteSessionId(name);
    }
    this.sessionPrompted.delete(name);
    this.lastSent.delete(name);
    this.toolNameById.clear();
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

    const promise = this._startAgentInternal(moduleName);
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
    return this.agents.get(moduleName)?.launched.cwd ?? null;
  }

  /** 计算模块的 workspace cwd（无需 agent 运行） */
  getWorkspaceCwd(moduleName: string): string | null {
    const node = this.graph?.nodes.get(moduleName);
    if (!node) return null;
    // 根模块
    if (node.relativePath === '.') {
      return path.join(this.projectRoot, '.module-agent', 'module');
    }
    // 子模块：优先用 workspacePath，fallback 到 absolutePath
    const workspaceRoot = path.join(this.projectRoot, '.module-agent', 'workspace');
    return node.workspacePath || workspacePathForModule(node, workspaceRoot, this.projectRoot);
  }

  getAgentModes(moduleName: string): { value: string; name: string; current: boolean }[] {
    const entry = this.agents.get(moduleName);
    if (!entry?.modeOptions?.length) return [];
    return entry.modeOptions.map(m => ({ ...m, current: m.value === entry.currentMode }));
  }

  /** 更新内存中的 defaultMode（新启动的 agent 会用到） */
  setDefaultMode(modeValue: string): void {
    if (this.config) {
      this.config.agents.default.defaultMode = modeValue;
    }
  }

  async setAgentMode(moduleName: string, modeValue: string): Promise<void> {
    const entry = this.agents.get(moduleName);
    if (!entry) throw new Error(`Agent ${moduleName} not running`);
    await entry.launched.connection.setSessionConfigOption({ sessionId: entry.sessionId, configId: 'mode', value: modeValue });
    entry.currentMode = modeValue;
    this.logger.info(`[${moduleName}] mode switched to ${modeValue}`);
  }

  // -----------------------------------------------------------------------
  // 公共辅助方法（供 McpBackend 集成）
  // -----------------------------------------------------------------------

  resolveAgentConfig(moduleName: string): AgentConfig {
    if (!this.config) return { command: 'opencode', args: ['acp'] };

    const modules = this.config.agents.modules;
    const def = this.config.agents.default;
    if (modules && modules[moduleName]) {
      const mod = modules[moduleName]!;
      return {
        command: mod.command,
        args: mod.args,
        model: mod.model || def.model,
        defaultMode: mod.defaultMode || def.defaultMode,
      };
    }
    return {
      command: def.command,
      args: def.args || [],
      model: def.model,
      defaultMode: def.defaultMode,
    };
  }

  buildPromptBlocksForModule(moduleName: string, text: string): ContentBlock[] {
    return buildPromptBlocks({
      moduleName,
      userText: text,
      graph: this.graph,
      prompts: this.prompts,
      sessionPrompted: this.sessionPrompted,
    });
  }

  hasPromptedModule(moduleName: string): boolean {
    return this.sessionPrompted.has(moduleName);
  }

  // -----------------------------------------------------------------------
  // 内部：启动管道（从 AgentOrchestrator 合并）
  // -----------------------------------------------------------------------

  private async _startAgentInternal(moduleName: string): Promise<AgentEntry> {
    let launched: LaunchedAgent | null = null;

    try {
      const agentConfig = this.resolveAgentConfig(moduleName);
      const node = this.graph?.nodes.get(moduleName) ?? null;

      const workspaceRoot = path.join(this.projectRoot, '.module-agent', 'workspace');
      let cwd: string;
      this.logger.info(`_startAgentInternal ${node?.relativePath} this.config?.projectPath`);
      if (node && this.config?.projectPath) {
        if (node.relativePath === '.') {
          // 根模块: cwd 放在 .module-agent/module/，不拷贝
          cwd = path.join(this.projectRoot, '.module-agent', 'module');
        } else {
          // 非根模块: workspace 隔离拷贝
          await prepareModuleWorkspace(node, {
            workspaceRoot,
            projectPath: this.config.projectPath,
            graph: this.graph,
          });
          cwd = workspacePathForModule(node, workspaceRoot, this.projectRoot);
        }
      } else {
        // 无 projectPath 时：根模块也用 .module-agent/module/，非根模块用 node 绝对路径
        cwd = node?.relativePath === '.'
          ? path.join(this.projectRoot, '.module-agent', 'module')
          : node?.absolutePath || this.projectRoot;
      }

      const subModuleDirs = node
        ? getSubModuleDirs(node, this.graph, (n) =>
            workspacePathForModule(n, workspaceRoot, this.projectRoot),
          )
        : [];

      this._ensureGitAnchor(cwd);

      this.logger.info(
        `startAgent [${moduleName}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${cwd}`,
      );

      launched = await this.launcher.launch(agentConfig, moduleName, cwd, this.logger, { subModuleDirs });

      // 打印 Agent 能力
      const caps = launched.agentCapabilities;
      this.logger.info(`[${moduleName}] agent capabilities: ${JSON.stringify(caps)}`);
      const sessionCaps = (caps as any)?.sessionCapabilities;
      this.logger.info(`[${moduleName}] session capabilities: ${JSON.stringify(sessionCaps)}`);
      const hasResume = !!(sessionCaps?.resume);

      // 连接会话更新 → CoreCallbacks + 外部监听器
      const self = this;
      launched.onSessionUpdate = (name, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;

        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(name, block.text, 'message');
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(name, block.text, 'thought');
        } else if (update === 'tool_call') {
          this.logger.info(`[${name}] tool_call: ${(data as { title?: string }).title || 'unknown'} ${JSON.stringify(notification)}`);
          const tc = data as { title?: string; status?: string; name?: string; toolName?: string; toolCallId?: string; input?: Record<string, unknown>; arguments?: Record<string, unknown>; params?: Record<string, unknown>; toolCall?: Record<string, unknown> };
          const toolName = tc.title || tc.toolName || tc.name || 'unknown';
          const toolStatus = tc.status || 'running';
          // 记录 toolCallId → 真实工具名（tool_call_update 的 title 会被 agent 覆写）
          if (tc.toolCallId && tc.title) this.toolNameById.set(tc.toolCallId, tc.title);
          // 尝试多个可能的参数字段
          const toolInput = tc.input || tc.arguments || tc.params || tc.toolCall;
          const detail = toolInput ? JSON.stringify(toolInput).slice(0, 200) : undefined;
          self.callbacks.onToolCall?.(name, toolName, toolStatus, detail);
          if (tc.status === 'error') {
            self.callbacks.onStreamError(name, `Tool call failed: ${toolName}`);
          }
        } else if (update === 'tool_call_update') {
          const tc = data as { title?: string; status?: string; toolCallId?: string; toolName?: string; name?: string; rawInput?: Record<string, unknown> };
          // tool_call_update 的 title 可能是脏数据（搜索结果等），优先用 toolCallId 查真实工具名
          const realName = (tc.toolCallId && this.toolNameById.get(tc.toolCallId)) || tc.toolName || tc.title || tc.name || 'unknown';
          if (tc.status) {
            self.callbacks.onToolCall?.(name, realName, tc.status);
          }
        }

        if (self._onSessionUpdate) {
          self._onSessionUpdate(name, sessionId, notification);
        }
      };

      // 构建 MCP 服务器
      const mcpServers = buildMcpServers({
        moduleName,
        basePath: this.basePath,
        backendPort: this.mcpBackendPort,
        graphFile: this.mcpGraphFile,
      });

      let sessionId: string;

      // 尝试恢复上次会话
      const savedSessionId = this._loadSessionId(moduleName);
      this.logger.info(`[${moduleName}] savedSessionId=${savedSessionId || '(none)'} hasResume=${hasResume}`);
      let sessionResult: any = null; // newSession 或 resumeSession 的响应

      if (hasResume && savedSessionId) {
        try {
          this.logger.info(`[${moduleName}] attempting session/resume id=${savedSessionId}`);
          sessionResult = await launched.connection.resumeSession!({
            sessionId: savedSessionId,
            cwd: launched.cwd,
            mcpServers,
          });
          sessionId = savedSessionId;
          this.logger.info(`[${moduleName}] resumed session ${sessionId}`);
        } catch (err) {
          this.logger.warn(`[${moduleName}] resume failed, creating new session: ${(err as Error).message}`);
          sessionResult = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
          sessionId = sessionResult.sessionId;
        }
      } else {
        if (savedSessionId && !hasResume) {
          this.logger.info(`[${moduleName}] agent doesn't support resume, creating new session`);
        }
        sessionResult = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
        sessionId = sessionResult.sessionId;
      }

      // 持久化 sessionId
      this._saveSessionId(moduleName, sessionId);

      // 设置 mode / model（提取为独立方法供 clearContext 复用）
      const savedModes = await this._applySessionConfig(moduleName, agentConfig, launched.connection, sessionId, sessionResult);

      // 保存 mode 配置到 entry 供查询
      const savedCurrentMode = (sessionResult?.configOptions as any[])
        ?.find((o: any) => o.id === 'mode' || o.category === 'mode')
        ?.currentValue;

      this.sessionPrompted.delete(moduleName);

      const entry: AgentEntry = {
        name: moduleName,
        config: agentConfig,
        launched,
        sessionId,
        modulePath: cwd,
        capabilities: launched.agentCapabilities,
        modeOptions: savedModes,
        currentMode: savedCurrentMode,
      };
      this.agents.set(moduleName, entry);

      this.logger.info(`startAgent [${moduleName}] ready, sessionId=${sessionId}`);
      return entry;
    } catch (err) {
      if (launched) {
        try { launched.process.kill(); } catch { /* 忽略 */ }
      }
      this.logger.error(`startAgent [${moduleName}] failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Session 持久化（用于 resume）
  // -----------------------------------------------------------------------

  private _sessionStoreDir(): string {
    return path.join(this.projectRoot, '.module-agent', 'sessions');
  }

  private _sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_');
  }

  private _saveSessionId(moduleName: string, sessionId: string): void {
    try {
      const dir = this._sessionStoreDir();
      fs.ensureDirSync(dir);
      const file = path.join(dir, `${this._sanitizeFileName(moduleName)}.json`);
      fs.writeJsonSync(file, { sessionId, savedAt: new Date().toISOString() });
      this.logger.info(`[session] saved ${moduleName} → ${sessionId}`);
    } catch (err) {
      this.logger.warn(`[session] failed to save sessionId: ${(err as Error).message}`);
    }
  }

  /** 在 cwd 创建 .git 目录结构，防止 opencode 向上追溯 */
  private _ensureGitAnchor(cwd: string): void {
    try {
      const gitDir = path.join(cwd, '.git');
      if (!fs.existsSync(gitDir)) {
        fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
        fs.mkdirSync(path.join(gitDir, 'objects'), { recursive: true });
        fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      }
    } catch { /* ignore */ }
  }

  /** 从工具参数中提取路径字段 */
  private _extractPaths(rawInput: Record<string, unknown>): string[] {
    const keys = ['filePath', 'filepath', 'path', 'directory', 'parentDir',
      'sourcePath', 'targetPath', 'file', 'dir', 'folder'];
    const paths: string[] = [];
    for (const key of keys) {
      const v = rawInput[key];
      if (typeof v === 'string' && v.length > 0) paths.push(v);
    }
    return paths;
  }

  private _deleteSessionId(moduleName: string): void {
    try {
      const file = path.join(this._sessionStoreDir(), `${this._sanitizeFileName(moduleName)}.json`);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        this.logger.info(`[session] deleted sessionId for [${moduleName}]`);
      }
    } catch (err) {
      this.logger.warn(`[session] failed to delete sessionId: ${(err as Error).message}`);
    }
  }

  private _loadSessionId(moduleName: string): string | null {
    try {
      const file = path.join(this._sessionStoreDir(), `${this._sanitizeFileName(moduleName)}.json`);
      if (fs.existsSync(file)) {
        const data = fs.readJsonSync(file) as { sessionId: string };
        return data.sessionId || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  // -----------------------------------------------------------------------
  // 消息路由（从 AgentRouter 而来）
  // -----------------------------------------------------------------------

  private _routeMessage(message: string): { targetName: string | null; prompt: string } {
    // 关键词匹配：@moduleName 或 模块: name
    const keyword = this._extractModuleKeyword(message);
    if (keyword) {
      const target = this._findModule(keyword);
      if (target && this.agents.has(target)) {
        return { targetName: target, prompt: message };
      }
    }

    // 文件路径匹配
    const pathMatch = this._extractFilePath(message);
    if (pathMatch) {
      const target = this._findModuleByFile(pathMatch);
      if (target && target !== this.graph?.root && this.agents.has(target)) {
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

  /** 应用 session 配置：mode + model，返回 modeOptions */
  private async _applySessionConfig(
    moduleName: string,
    agentConfig: AgentConfig,
    connection: { setSessionConfigOption(params: { sessionId: string; configId: string; value: string }): Promise<any> },
    sessionId: string,
    sessionResult: any,
  ): Promise<{ value: string; name: string }[]> {
    // mode
    try {
      const configOptions = sessionResult?.configOptions as any[];
      if (configOptions) {
        const modeOpt = configOptions.find((o: any) => o.id === 'mode' || o.category === 'mode');
        if (modeOpt) {
          const ids = modeOpt.options?.map((o: any) => `${o.value}(${o.name})`).join(', ') || '(none)';
          this.logger.info(`[${moduleName}] configOptions mode: current=${modeOpt.currentValue}, available=[${ids}]`);
          // 优先用配置的 defaultMode，其次找含 ask/permission 的，再回退到第一个非 current
          const configured = agentConfig.defaultMode
            ? modeOpt.options?.find((o: any) => o.value === agentConfig.defaultMode || o.name === agentConfig.defaultMode)
            : null;
          const preferred = configured
            || modeOpt.options?.find((o: any) =>
                o.value.includes('ask') || o.value.includes('permission') || o.name.toLowerCase().includes('ask'));
          const target = preferred || modeOpt.options?.find((o: any) => o.value !== modeOpt.currentValue) || modeOpt.options?.[0];
          if (target && target.value !== modeOpt.currentValue) {
            await connection.setSessionConfigOption({ sessionId, configId: 'mode', value: target.value });
            this.logger.info(`[${moduleName}] setSessionConfigOption mode=${target.value}`);
          } else {
            this.logger.info(`[${moduleName}] mode already=${modeOpt.currentValue}, keeping`);
          }
          return modeOpt.options?.map((o: any) => ({ value: o.value, name: o.name })) || [];
        }
      } else {
        const blindModes = [agentConfig.defaultMode, 'ask', 'ask-mode', 'permission', 'safe'].filter(Boolean) as string[];
        for (const tryMode of blindModes) {
          try {
            await connection.setSessionConfigOption({ sessionId, configId: 'mode', value: tryMode });
            this.logger.info(`[${moduleName}] setSessionConfigOption mode=${tryMode}`);
            break;
          } catch { /* try next */ }
        }
      }
    } catch (err) {
      this.logger.info(`[${moduleName}] setSessionConfigOption(mode): ${(err as Error).message}`);
    }

    // model
    if (agentConfig.model) {
      try {
        await connection.setSessionConfigOption({ sessionId, configId: 'model', value: agentConfig.model });
        this.logger.info(`[${moduleName}] setSessionConfigOption model=${agentConfig.model}`);
      } catch (err) {
        this.logger.info(`[${moduleName}] setSessionConfigOption(model): ${(err as Error).message}`);
      }
    }

    return [];
  }

  private _findModule(keyword: string): string | undefined {
    const lower = keyword.toLowerCase();
    for (const [name] of this.graph?.nodes || []) {
      if (name.toLowerCase() === lower) return name;
    }
    for (const [name] of this.graph?.nodes || []) {
      if (name.toLowerCase().includes(lower)) return name;
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
