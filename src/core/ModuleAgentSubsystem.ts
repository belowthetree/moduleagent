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
      try { entry.launched.process.kill(); } catch { /* 忽略 */ }
      this.agents.delete(name);
      this.logger.info(`clearContext: stopped agent [${name}]`);
    }
    this.sessionPrompted.delete(name);
    this.lastSent.delete(name);
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

  // -----------------------------------------------------------------------
  // 公共辅助方法（供 McpBackend 集成）
  // -----------------------------------------------------------------------

  resolveAgentConfig(moduleName: string): AgentConfig {
    if (!this.config) return { command: 'opencode', args: ['acp'] };

    const modules = this.config.agents.modules;
    if (modules && modules[moduleName]) {
      return {
        command: modules[moduleName]!.command,
        args: modules[moduleName]!.args,
      };
    }
    return {
      command: this.config.agents.default.command,
      args: this.config.agents.default.args || [],
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
        cwd = node?.absolutePath || this.projectRoot;
      }

      const subModuleDirs = node
        ? getSubModuleDirs(node, this.graph, (n) =>
            workspacePathForModule(n, workspaceRoot, this.projectRoot),
          )
        : [];

      this.logger.info(
        `startAgent [${moduleName}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${cwd}`,
      );

      launched = await this.launcher.launch(agentConfig, moduleName, cwd, this.logger, { subModuleDirs });

      // 连接会话更新 → CoreCallbacks + 外部监听器
      const self = this;
      launched.onSessionUpdate = (name, sessionId, notification) => {
        const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
        const data = notification.update as Record<string, unknown>;

        // 打印收到的 ACP 事件类型
        if (update) {
          const preview = typeof data.content === 'object' && (data.content as any)?.text
            ? (data.content as any).text.slice(0, 80)
            : '';
          self.logger.info(`[ACP] ${name} ← ${update}${preview ? ` "${preview}"` : ''}`);
        }

        if (update === 'agent_message_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(name, block.text, 'message');
        } else if (update === 'agent_thought_chunk') {
          const block = data.content as { type?: string; text?: string } | undefined;
          if (block?.text) self.callbacks.onStreamChunk(name, block.text, 'thought');
        } else if (update === 'tool_call') {
          const tc = data as { title?: string; status?: string };
          if (tc.status === 'error') {
            self.callbacks.onStreamError(name, `Tool call failed: ${tc.title || 'unknown'}`);
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

      const result = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
      const sessionId = result.sessionId;

      this.sessionPrompted.delete(moduleName);

      const entry: AgentEntry = {
        name: moduleName,
        config: agentConfig,
        launched,
        sessionId,
        modulePath: cwd,
        capabilities: launched.agentCapabilities,
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
