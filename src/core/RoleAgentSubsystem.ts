import path from 'path';
import fs from 'fs';
import os from 'os';
import { AgentLauncher } from '../agents/AgentLauncher.js';
import { RoleAgentManager, type RoleAgentEntry } from '../agents/RoleAgentManager.js';
import type { RoleConfig } from '../config/defaults.js';
import type { SessionNotification, ContentBlock } from '@agentclientprotocol/sdk';
import { defaultLogger, type Logger } from './Logger.js';
import type { CoreCallbacks } from './CoreTypes.js';

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
  onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;
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
  private _onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;

  constructor(options: RoleAgentSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.logger = options.logger || defaultLogger;
    this.projectPath = options.projectPath;
    this._onSessionUpdate = options.onSessionUpdate;

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
            const tc = data as { title?: string; status?: string };
            if (tc.status === 'error') {
              self.callbacks.onStreamError(roleName, `Tool call failed: ${tc.title || 'unknown'}`);
            }
          }

          if (self._onSessionUpdate) {
            self._onSessionUpdate(roleName, sessionId, notification);
          }
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

  async sendMessage(roleName: string, text: string): Promise<void> {
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
        // 需要 RoleConfig 才能启动——调用者必须先通过 startRole() 启动
        throw new Error(`Role agent "${roleName}" not started. Call startRole() first.`);
      }

      const blocks = this.buildPromptBlocks(roleName, text);

      this.callbacks.onStatusChange('streaming');
      this.logger.info(`role:send [${roleName}] len=${text.length} blocks=${blocks.length}`);

      await entry.launched.connection.prompt({
        sessionId: entry.sessionId,
        prompt: blocks,
      });

      this.callbacks.onStreamComplete(roleName);
      this.callbacks.onStatusChange('idle');
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`role:send [${roleName}] failed: ${message}`);
      this.callbacks.onStreamError(roleName, message);
      this.callbacks.onStatusChange('error');
      this.callbacks.onMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Error: ${message}`,
        time: new Date().toLocaleTimeString(),
      });
    } finally {
      resolveLock();
      this.sendLock.delete(roleName);
    }
  }

  async cancel(roleName: string): Promise<void> {
    const entry = this.manager.getAgent(roleName);
    if (!entry) return;

    try {
      await entry.launched.connection.cancel({ sessionId: entry.sessionId });
      this.logger.info(`role:cancel [${roleName}]`);
    } catch {
      // 忽略
    }
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
  buildPromptBlocks(roleName: string, userText: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
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
