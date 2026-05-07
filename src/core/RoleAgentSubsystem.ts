import path from 'path';
import fs from 'fs';
import { AgentLauncher } from '../agents/AgentLauncher.js';
import { RoleAgentManager, type RoleAgentEntry } from '../agents/RoleAgentManager.js';
import type { RoleConfig } from '../config/defaults.js';
import type { SessionNotification, ContentBlock } from '@agentclientprotocol/sdk';
import { defaultLogger, type Logger } from './Logger.js';
import type { CoreCallbacks } from './CoreTypes.js';

// ---------------------------------------------------------------------------
// RoleAgentSubsystem options
// ---------------------------------------------------------------------------

export interface RoleAgentSubsystemOptions {
  callbacks: CoreCallbacks;
  basePath: string;
  configDir?: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  /** Optional external session-update listener (e.g. AgentStateManager) */
  onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;
}

// ---------------------------------------------------------------------------
// RoleAgentSubsystem
// ---------------------------------------------------------------------------

export class RoleAgentSubsystem {
  private callbacks: CoreCallbacks;
  private logger: Logger;
  private manager: RoleAgentManager;
  private rolePrompt = '';
  private sessionPrompted = new Set<string>();
  private sendLock = new Map<string, Promise<void>>();
  private _onSessionUpdate?: (roleName: string, sessionId: string, notification: SessionNotification) => void;

  constructor(options: RoleAgentSubsystemOptions) {
    this.callbacks = options.callbacks;
    this.logger = options.logger || defaultLogger;
    this._onSessionUpdate = options.onSessionUpdate;

    // Load role agent prompt
    const resolvedConfigDir = options.configDir || path.join(options.basePath, 'config');
    const rolePromptPath = path.join(resolvedConfigDir, 'roleagentprompt.md');
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
  // Lifecycle
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
  // Send / cancel
  // -----------------------------------------------------------------------

  async sendMessage(roleName: string, text: string): Promise<void> {
    const prevLock = this.sendLock.get(roleName);
    if (prevLock) {
      try { await prevLock; } catch { /* proceed */ }
    }

    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(r => { resolveLock = r; });
    this.sendLock.set(roleName, lockPromise);

    try {
      let entry = this.manager.getAgent(roleName);
      if (!entry) {
        // Need RoleConfig to start — caller must have started via startRole() first
        throw new Error(`Role agent "${roleName}" not started. Call startRole() first.`);
      }

      const blocks = this._buildPromptBlocks(roleName, text);

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
      // ignore
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getAgent(roleName: string): RoleAgentEntry | undefined {
    return this.manager.getAgent(roleName);
  }

  listAgents(): string[] {
    return this.manager.listAgents();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _buildPromptBlocks(roleName: string, userText: string): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    const isFirst = !this.sessionPrompted.has(roleName);

    if (isFirst) {
      this.sessionPrompted.add(roleName);
      if (this.rolePrompt) {
        blocks.push({ type: 'text', text: this.rolePrompt + '\n\n---\n\n' });
      }
    }

    blocks.push({ type: 'text', text: userText });
    return blocks;
  }
}
