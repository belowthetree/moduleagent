import path from 'path';
import fs from 'fs-extra';
import { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { defaultLogger } from '../core/Logger.js';
import { ExperienceSummarizer } from '../core/ExperienceSummarizer.js';
import type { AgentStatus, ChatMessage } from './types.js';
import type { CoreCallbacks, CoreStatus, CoreMessage, InitResult } from '../core/CoreTypes.js';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { ChatMsg } from '../types/preload.js';
import { tuiState } from './state.js';

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

export class TuiBridge {
  core: ModuleAgentCore;
  private status: AgentStatus = 'idle';
  private loadedModules = new Set<string>();
  private summarizer: ExperienceSummarizer;
  private configDir: string;

  constructor() {
    this.summarizer = new ExperienceSummarizer(defaultLogger);
    this.configDir = path.join(findRepoRoot(), 'config');

    const callbacks: CoreCallbacks = {
      onStreamChunk: (_moduleName, text) => {
        const msgs = tuiState.messages();
        if (msgs.length === 0) return;
        const lastMsg = msgs[msgs.length - 1]!;
        const updated = [...msgs];
        updated[msgs.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + text,
        };
        tuiState.setMessages(updated);
      },
      onStreamComplete: (_moduleName) => {
        const msgs = tuiState.messages();
        if (msgs.length === 0) return;
        const updated = [...msgs];
        updated[msgs.length - 1] = {
          ...updated[msgs.length - 1]!,
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages(updated);
        this.setStatus('idle');
      },
      onStreamError: (_moduleName, error) => {
        this.setStatus('error');
        const msg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'system',
          content: `Error: ${error}`,
          time: new Date().toLocaleTimeString(),
        };
        tuiState.setMessages([...tuiState.messages(), msg]);
      },
      onStatusChange: (status: CoreStatus) => {
        this.setStatus(status);
      },
      onMessage: (message: CoreMessage) => {
        tuiState.setMessages([...tuiState.messages(), message as ChatMessage]);
      },
    };

    const repoRoot = findRepoRoot();
    this.core = new ModuleAgentCore({
      callbacks,
      basePath: repoRoot,
      configDir: path.join(repoRoot, 'config'),
      logger: defaultLogger,
    });
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  async init(projectRoot: string): Promise<InitResult> {
    const result = await this.core.init(projectRoot);
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

  async sendMessage(text: string): Promise<void> {
    try {
      // 向 UI 添加用户消息
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), userMsg]);

      // 添加空的 Agent 消息用于流式展示
      const streamMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: '',
        time: '',
      };
      tuiState.setMessages([...tuiState.messages(), streamMsg]);

      const targetName = this.core.getCurrentAgent();
      if (targetName && !this.loadedModules.has(targetName)) {
        this.loadedModules.add(targetName);
      }

      await this.core.sendMessage(text);

      // 触发即忘的经验总结（后台执行）
      const projectRoot = this.core.getProjectRoot();
      if (projectRoot && targetName) {
        defaultLogger.info(`Triggering summarizer for [${targetName}]`);
        const msgs = tuiState.messages();
        const chatMsgs: ChatMsg[] = msgs.map(m => ({
          id: m.id,
          role: (m.role === 'agent' ? 'agent' : m.role === 'user' ? 'user' : 'system') as ChatMsg['role'],
          content: m.content || '',
          thinking: '',
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
    } catch (err) {
      const msg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Send failed: ${(err as Error).message}`,
        time: new Date().toLocaleTimeString(),
      };
      tuiState.setMessages([...tuiState.messages(), msg]);
      this.setStatus('error');
    }
  }

  async cancel(): Promise<void> {
    await this.core.cancel();
    this.setStatus('idle');
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
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  private setStatus(status: AgentStatus): void {
    this.status = status;
    tuiState.setAgentStatus(status);
  }
}
