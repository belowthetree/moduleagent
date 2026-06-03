// ---------------------------------------------------------------------------
// tui/TuiSessionStore.ts — TUI 展示层会话状态管理
//
// 职责：
//   1. 从 Core 层查询历史消息（ChatMsg[]）并转换为 TUI 格式（ChatMessage[]）
//   2. 管理流式消息块的实时追加（replyId/thoughtId 追踪）
//   3. 将格式转换后的数据同步到 tuiState（SolidJS signals）
//
// 不做：消息持久化（由 Core AgentStateManager 负责）、Agent 操作（由 Core 负责）
// ---------------------------------------------------------------------------

import type { ChatMsg } from '../types/shared.js';
import type { ChatMessage, MessageType } from './types.js';
import type { ReactiveTuiState } from './state.js';
import type { ModuleAgentCore } from '../core/ModuleAgentCore.js';
import { defaultLogger } from '../core/Logger.js';

export class TuiSessionStore {
  /** 当前模块的消息列表（展示缓存，非持久化存储） */
  private _messages: ChatMessage[] = [];

  /** 流式消息 ID 追踪 */
  private _replyId: string | null = null;
  private _thoughtId: string | null = null;

  /** 从 core 查询消息历史并转换为 TUI 格式 */
  async loadHistory(core: ModuleAgentCore, moduleName: string): Promise<void> {
    const msgs = await core.modules.loadContext(moduleName);
    this._messages = this._formatFromCore(msgs);
    defaultLogger.info(`TuiSessionStore: loaded ${this._messages.length} msgs for [${moduleName}]`);
  }

  /** 获取当前消息列表 */
  get messages(): ChatMessage[] {
    return this._messages;
  }

  /** 获取当前流式 reply 消息 ID */
  get replyId(): string | null {
    return this._replyId;
  }

  /** 获取当前流式 thought 消息 ID */
  get thoughtId(): string | null {
    return this._thoughtId;
  }

  // ── 流式消息块管理 ──

  /** 开始新的流式会话，生成新的消息 ID */
  startStream(): void {
    const now = Date.now();
    this._replyId = `reply-${now}`;
    this._thoughtId = `thought-${now}`;
  }

  /** 追加文本到指定 ID 的流式消息块（不存在则创建） */
  appendChunk(msgId: string | null, text: string, msgType: MessageType): void {
    const id = msgId || `${msgType}-${Date.now()}`;
    const idx = this._messages.findIndex(m => m.id === id);
    if (idx === -1) {
      this._messages.push({ id, role: 'agent', msgType, content: text, time: '' });
    } else {
      this._messages[idx] = { ...this._messages[idx]!, content: this._messages[idx]!.content + text };
    }
  }

  /** 标记流式消息完成（设置时间戳） */
  finalizeStream(): void {
    const time = new Date().toLocaleTimeString();
    for (const id of [this._replyId, this._thoughtId]) {
      if (!id) continue;
      const idx = this._messages.findIndex(m => m.id === id);
      if (idx !== -1) {
        this._messages[idx] = { ...this._messages[idx]!, time };
      }
    }
  }

  // ── 用户消息 ──

  /** 追加用户消息 */
  addUserMsg(text: string): void {
    this._messages.push({
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      msgType: 'user',
      content: text,
      time: new Date().toLocaleTimeString(),
    });
  }

  /** 追加系统错误消息 */
  addErrorMsg(error: string): void {
    this._messages.push({
      id: `err-${Date.now()}`,
      role: 'system',
      msgType: 'system',
      content: `Error: ${error}`,
      time: new Date().toLocaleTimeString(),
    });
  }

  /** 直接设置消息列表（用于从持久化加载等场景） */
  setMessages(msgs: ChatMessage[]): void {
    this._messages = msgs;
  }

  // ── 清空 ──

  /** 清空当前模块的消息（不持久化——由 Core 管理） */
  clear(): void {
    this._messages = [];
    this._replyId = null;
    this._thoughtId = null;
  }

  /** 清空流式 ID（不清空消息列表） */
  resetStream(): void {
    // 不清空 ID：system message 的 queue drain 完成后 agent 可能还在推送残余 chunk
  }

  // ── tuiState 同步 ──

  /** 将当前消息列表同步到 tuiState signals */
  syncTo(state: ReactiveTuiState): void {
    state.setMessages([...this._messages]);
  }

  /** 获取折叠的思考消息 ID 集合 */
  getCollapsedThoughts(): Set<string> {
    const collapsed = new Set<string>();
    for (const m of this._messages) {
      if (m.msgType === 'agent_thought' && m.content) {
        collapsed.add(m.id);
      }
    }
    return collapsed;
  }

  // ── 格式转换 ──

  /**
   * 将 Core 的 ChatMsg[] 转换为 TUI 的 ChatMessage[]。
   * 一条 agent ChatMsg 可能展开为两条 ChatMessage：
   *   - agent_reply（content 字段）
   *   - agent_thought（thinking 字段，非空时）
   */
  private _formatFromCore(msgs: ChatMsg[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of msgs) {
      switch (msg.role) {
        case 'user':
          result.push({
            id: msg.id,
            role: 'user',
            msgType: 'user',
            content: msg.content || '',
            time: msg.time || '',
          });
          break;
        case 'agent':
          // thinking → agent_thought（如有内容）
          if (msg.thinking?.trim()) {
            result.push({
              id: msg.id + '-thought',
              role: 'agent',
              msgType: 'agent_thought',
              content: msg.thinking,
              time: msg.time || '',
            });
          }
          // content → agent_reply
          result.push({
            id: msg.id,
            role: 'agent',
            msgType: 'agent_reply',
            content: msg.content || '',
            time: msg.time || '',
          });
          break;
        case 'system':
          result.push({
            id: msg.id,
            role: 'system',
            msgType: 'system',
            content: msg.content || '',
            time: msg.time || '',
          });
          break;
        default:
          // cross 等其他角色按 system 处理
          result.push({
            id: msg.id,
            role: 'system',
            msgType: 'system',
            content: msg.content || '',
            time: msg.time || '',
          });
      }
    }
    return result;
  }
}
