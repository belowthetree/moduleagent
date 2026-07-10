// ---------------------------------------------------------------------------
// core/RoleAgentSubsystem.ts — 角色 Agent 子系统
// 管理角色 Agent 生命周期：启动、停止、消息发送、角色提示构建、MCP 服务器构建
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import os from 'os';
import { AgentLauncher } from '../agents/AgentLauncher.js';
import { RoleAgentManager, type RoleAgentEntry } from '../agents/RoleAgentManager.js';
import { AgentStateManager } from '../agents/AgentStateManager.js';
import type { RoleConfig } from '../config/defaults.js';
import type { PromptBlock } from '../agents/kernel/types.js';
import { defaultLogger, type Logger } from './Logger.js';
import type { CoreCallbacks } from './CoreTypes.js';
import type { ChatMsg } from '../types/shared.js';

// ---------------------------------------------------------------------------
// RoleAgentSubsystem 选项
// ---------------------------------------------------------------------------

export interface RoleAgentSubsystemOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  /** 可选的外部会话更新监听器（如 AgentStateManager） */
  onSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  /** Shared AgentStateManager for stream accumulation + context persistence */
  stateManager?: AgentStateManager;
  /** Post-send hook (summarizer + workspace diff) */
  onPostSend?: (roleName: string, msgs: ChatMsg[], entry: RoleAgentEntry) => void;
}

// ---------------------------------------------------------------------------
// RoleAgentSubsystem — 角色 Agent 子系统
// ---------------------------------------------------------------------------

export class RoleAgentSubsystem {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private manager: RoleAgentManager;
  private projectPath: string;
  private rolePrompt = '';
  private sessionPrompted = new Set<string>();
  private sendLock = new Map<string, Promise<void>>();
  private _onSessionUpdate?: (roleName: string, sessionId: string, notification: any) => void;
  private _stateManager: AgentStateManager | null = null;
  private _onPostSend?: (roleName: string, msgs: ChatMsg[], entry: RoleAgentEntry) => void;

  constructor(options: RoleAgentSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.logger = options.logger || defaultLogger;
    this.projectPath = options.projectPath;
    this._onSessionUpdate = options.onSessionUpdate;
    this._stateManager = options.stateManager || null;
    this._onPostSend = options.onPostSend;

    // 加载角色 Agent 提示词
    const resolvedConfigDir = options.configDir || path.join(options.basePath, 'config');
    const rolePromptPath = path.join(resolvedConfigDir, 'knowledge', 'roleagentprompt.md');
    try {
      this.rolePrompt = fs.readFileSync(rolePromptPath, 'utf-8');
      this.logger.info(`Loaded role agent prompt (${this.rolePrompt.length} chars)`);
    } catch {
      this.rolePrompt = '';
      this.logger.warn('Failed to read role agent prompt');
    }

    const launcher = new AgentLauncher();
    const self = this;

    this.manager = new RoleAgentManager({
      launcher,
      basePath: options.basePath,
      projectPath: options.projectPath,
      workspaceRoot: options.workspaceRoot,
      logger: this.logger,
      callbacks: {
        onSessionUpdate(roleName, sessionId, notification) {
          const update = (notification.update as { sessionUpdate?: string }).sessionUpdate;
          const data = notification.update as Record<string, unknown>;
          if (update) self.logger.info(`[ACP:role] ${roleName} ← ${update}`);

          if (update === 'agent_message_chunk') {
            const block = data.content as { type?: string; text?: string } | undefined;
            if (block?.text) self.callbacks.onStreamChunk(roleName, block.text, 'message');
          } else if (update === 'agent_thought_chunk') {
            const block = data.content as { type?: string; text?: string } | undefined;
            if (block?.text) self.callbacks.onStreamChunk(roleName, block.text, 'thought');
          } else if (update === 'tool_call') {
            const tc = data as { title?: string; status?: string; input?: Record<string, unknown>; arguments?: Record<string, unknown> };
            const toolInput = tc.input || tc.arguments;
            const detail = toolInput ? JSON.stringify(toolInput).slice(0, 200) : undefined;
            self.logger.info(`[${roleName}] tool_call: ${tc.title} input=${detail || '(none)'}`);
            self.callbacks.onToolCall?.(roleName, tc.title || 'unknown', tc.status || 'running', detail);
            if (tc.status === 'error') {
              self.callbacks.onStreamError(roleName, `Tool call failed: ${tc.title || 'unknown'}`);
            }
          } else if (update === 'tool_call_update') {
            const tc = data as { title?: string; status?: string };
            if (tc.title && tc.status) {
              self.callbacks.onToolCall?.(roleName, tc.title, tc.status);
            }
          }

          // 流累积：将通知路由到 AgentStateManager
          if (update) {
            self._stateManager?.appendChunk(`workrole:${roleName}`, update, data);
          }

          if (self._onSessionUpdate) {
            self._onSessionUpdate(roleName, sessionId, notification);
          }
        },
        onQueue: (qlen: number) => {
          self.callbacks.onMessage({
            id: `queue-${Date.now()}`,
            role: 'system',
            content: `Agent 正在工作中，您的输入已加入队列（第 ${qlen} 位）。`,
            time: new Date().toLocaleTimeString(),
          });
        },
        onSystemMessage: (text: string, _qlen: number) => {
          self.callbacks.onMessage({
            id: `sys-${Date.now()}`,
            role: 'system',
            content: text,
            time: new Date().toLocaleTimeString(),
          });
        },
      },
    });
  }

  // -----------------------------------------------------------------------
  // 生命周期
  // -----------------------------------------------------------------------

  async startRole(role: RoleConfig): Promise<RoleAgentEntry> {
    return this.manager.startRoleAgent(role);
  }

  async stopRole(roleName: string): Promise<void> {
    await this.manager.stopRoleAgent(roleName);
  }

  async dispose(): Promise<void> {
    await this.manager.stopAll();
    this.sessionPrompted.clear();
    this.sendLock.clear();
  }

  // -----------------------------------------------------------------------
  // 发送 / 取消
  // -----------------------------------------------------------------------

  async sendMessage(
    roleName: string,
    text: string,
  ): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: unknown[]; stopReason?: string }; error?: string }> {
    const prevLock = this.sendLock.get(roleName);
    if (prevLock) {
      try { await prevLock; } catch { /* 继续 */ }
    }

    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(r => { resolveLock = r; });
    this.sendLock.set(roleName, lockPromise);

    try {
      let entry = this.manager.getAgent(roleName);
      if (!entry) {
        throw new Error(`Role agent "${roleName}" not started. Call startRole() first.`);
      }

      const ctxKey = `workrole:${roleName}`;

      // ── 开始流累积 ──
      this._stateManager?.startStream(ctxKey);

      const blocks = this.buildPromptBlocks(roleName, text);

      this.callbacks.onStatusChange('streaming');
      this.logger.info(`role:send [${roleName}] len=${text.length} blocks=${blocks.length}`);

      // 使用 agent.send() 而非 connection.prompt() 直调：
      // send() 内部 _processMessage → _transition(Idle) → _drainQueue()
      // 确保权限拒绝排队的系统消息能被发送给 agent
      await entry.agent.send(blocks);

      // ── 结束流累积 ──
      const acc = this._stateManager?.finishStream(ctxKey);

      this.callbacks.onStreamComplete(roleName);
      this.callbacks.onStatusChange('idle');

      // ── 构建消息并持久化上下文 ──
      const timeStr = new Date().toLocaleTimeString();
      const userMsg: ChatMsg = {
        id: 'r' + Date.now().toString(36),
        role: 'user',
        content: text,
        thinking: '',
        time: timeStr,
        status: 'sent',
        moduleName: ctxKey,
      };
      const agentMsg: ChatMsg = {
        id: 'r' + (Date.now() + 1).toString(36),
        role: 'agent',
        content: acc?.reply || '',
        thinking: acc?.thinking || '',
        timeline: acc?.timeline || [],
        time: timeStr,
        status: 'completed',
        moduleName: ctxKey,
      };

      const existingMsgs = await this._stateManager?.loadContext(ctxKey) ?? [];
      existingMsgs.push(userMsg, agentMsg);
      await this._stateManager?.saveContext(ctxKey, existingMsgs);

      // ── 后处理钩子 ──
      this._onPostSend?.(roleName, existingMsgs, entry);

      return {
        result: {
          reply: acc?.reply || '',
          thinking: acc?.thinking || '',
          tools: acc?.tools || '',
          timeline: acc?.timeline || [],
        },
      };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`role:send [${roleName}] failed: ${message}`);
      const ctxKey = `workrole:${roleName}`;
      this._stateManager?.stopStream(ctxKey);
      this.callbacks.onStreamError(roleName, message);
      this.callbacks.onStatusChange('error');
      return { error: message };
    } finally {
      resolveLock();
      this.sendLock.delete(roleName);
    }
  }

  async cancel(roleName: string): Promise<void> {
    const entry = this.manager.getAgent(roleName);
    if (!entry) return;

    await entry.agent.cancel();
    this.logger.info(`role:cancel [${roleName}] → stopped`);
  }

  // -----------------------------------------------------------------------
  // 查询
  // -----------------------------------------------------------------------

  getAgent(roleName: string): RoleAgentEntry | undefined {
    return this.manager.getAgent(roleName);
  }

  listAgents(): string[] {
    return this.manager.listAgents();
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 构建角色 Agent 的提示块，首条消息包含知识引用。 */
  buildPromptBlocks(roleName: string, userText: string): PromptBlock[] {
    const blocks: PromptBlock[] = [];
    const isFirst = !this.sessionPrompted.has(roleName);

    if (isFirst) {
      this.sessionPrompted.add(roleName);
      if (this.rolePrompt) {
        blocks.push({ type: 'text', text: this.rolePrompt + '\n\n---\n\n' });
      }

      // 在首条消息中注入知识引用
      const entry = this.manager.getAgent(roleName);
      const refs = entry?.roleConfig.knowledgeRefs;
      if (refs && refs.length > 0) {
        this.logger.info(`role:buildPrompt [${roleName}] injecting ${refs.length} knowledge ref(s): ${refs.map(r => r.name).join(', ')}`);
        const knowledgeBlock = this._buildKnowledgeBlock(refs);
        if (knowledgeBlock) {
          blocks.push({ type: 'text', text: knowledgeBlock });
          this.logger.info(`role:buildPrompt [${roleName}] knowledge injected (${knowledgeBlock.length} chars)`);
        } else {
          this.logger.warn(`role:buildPrompt [${roleName}] knowledge block empty — no files resolved`);
        }
      }
    }

    blocks.push({ type: 'text', text: userText });
    return blocks;
  }

  /**
   * 构建包含引用知识文件的提示块，
   * 格式化为 AI 可消费的内容。
   */
  private _buildKnowledgeBlock(refs: { filename: string; name: string }[]): string | null {
    const sections: string[] = [];

    for (const ref of refs) {
      const filePath = this._resolveKnowledgePath(ref.filename);
      if (!filePath) {
        this.logger.warn(`Knowledge file not found: ${ref.filename}`);
        continue;
      }
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        sections.push(`## ${ref.name}\n\n${content}`);
        this.logger.info(`role:buildPrompt knowledge file loaded: ${ref.filename} (${content.length} chars) from ${filePath}`);
      } catch (err) {
        this.logger.warn(`Failed to read knowledge file ${ref.filename}: ${(err as Error).message}`);
      }
    }

    if (sections.length === 0) return null;

    return (
      '# 参考知识\n\n' +
      '以下是与你职责相关的参考知识，请在回答问题时参考这些内容：\n\n' +
      sections.join('\n\n---\n\n') +
      '\n\n---\n\n'
    );
  }

  /**
   * 在所有知识目录中查找知识文件。
   */
  private _resolveKnowledgePath(filename: string): string | null {
    const dirs = [
      path.join(this.projectPath, '.module-agent', 'knowledge'),
      path.join(os.homedir(), '.module-agent', 'config', 'knowledge'),
    ];
    for (const dir of dirs) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) return filePath;
    }
    return null;
  }
}
