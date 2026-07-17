// ---------------------------------------------------------------------------
// StreamAccumulator.ts — Agent 会话存储
// 管理流累积器（回复/思考/工具调用）、时间线、对话上下文持久化
// ---------------------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';

import type { ChatMsg, TimelineEvent } from '../types/shared.js';
import { defaultLogger } from '../core/Logger.js';

// ── Types ──

export interface StreamSection {
  thinking: boolean;
  tools: boolean;
  reply: boolean;
}

export interface StreamAccumulator {
  reply: string;
  thinking: string;
  tools: string;
  timeline: TimelineEvent[];
  finished?: boolean;
  sections: StreamSection;
}

// ── Default factory ──

function createStreamAccumulator(): StreamAccumulator {
  return {
    reply: '',
    thinking: '',
    tools: '',
    timeline: [],
    sections: { thinking: false, tools: false, reply: false },
  };
}

// ── SessionStore ──

export interface SessionStoreOptions {
  /** 每模块持久化消息上限（默认 200） */
  maxMessages?: number;
  /** 每模块持久化文件大小上限字节（默认 5MB） */
  maxBytes?: number;
}

const DEFAULT_MAX_MESSAGES = 200;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class SessionStore {
  private readonly contextBaseDir: string;
  private readonly archiveBaseDir: string;
  private readonly maxMessages: number;
  private readonly maxBytes: number;
  private readonly streamState: Map<string, StreamAccumulator>;
  private readonly contextMap: Map<string, ChatMsg[]>;

  constructor(contextBaseDir: string, options: SessionStoreOptions = {}) {
    this.contextBaseDir = contextBaseDir;
    this.archiveBaseDir = path.resolve(contextBaseDir, '..', 'archives');
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.streamState = new Map();
    this.contextMap = new Map();
  }

  // ── Context directory ──

  async initContextDir(): Promise<void> {
    await fs.mkdir(this.contextBaseDir, { recursive: true });
  }

  // ── Stream lifecycle ──

  private getOrCreateStream(moduleName: string): StreamAccumulator {
    let st = this.streamState.get(moduleName);
    if (!st) {
      st = createStreamAccumulator();
      this.streamState.set(moduleName, st);
    }
    return st;
  }

  startStream(moduleName: string): void {
    this.streamState.set(moduleName, createStreamAccumulator());
  }

  appendChunk(moduleName: string, updateType: string, data: Record<string, unknown>): void {
    const st = this.getOrCreateStream(moduleName);
    if (st.finished) return;

    switch (updateType) {
      case 'agent_message_chunk': {
        const block = (data as { content?: { type?: string; text?: string; thinking?: string } }).content;
        // 将 thinking 类型块路由到思考累加器，而不是回复
        if (block?.type === 'thinking' && block.thinking) {
          st.thinking += block.thinking;
          if (!st.sections.thinking) st.sections.thinking = true;
          const last = st.timeline[st.timeline.length - 1];
          if (last && last.type === 'thinking') {
            last.content += block.thinking;
          } else {
            st.timeline.push({ type: 'thinking', content: block.thinking });
          }
        } else if (block?.type === 'text' && block.text) {
          st.reply += block.text;
          if (!st.sections.reply) st.sections.reply = true;
        }
        break;
      }
      case 'agent_thought_chunk': {
        const block = (data as { content?: { type?: string; text?: string; thinking?: string } }).content;
        const text = block?.type === 'text' ? block.text : block?.type === 'thinking' ? block.thinking : undefined;
        if (text) {
          st.thinking += text;
          if (!st.sections.thinking) st.sections.thinking = true;
          // 将连续的思考块合并为一个时间线事件
          const last = st.timeline[st.timeline.length - 1];
          if (last && last.type === 'thinking') {
            last.content += text;
          } else {
            st.timeline.push({ type: 'thinking', content: text });
          }
        }
        break;
      }
      case 'tool_call': {
        const tc = data as {
          title?: string;
          toolCallId: string;
          kind?: string;
          status?: 'pending' | 'in_progress' | 'completed' | 'failed';
        };
        const name = tc.title || tc.toolCallId || 'unknown';
        const kindLabel = tc.kind ? `[${tc.kind}]` : '';
        const statusStr = tc.status ? `(${tc.status})` : '';
        const line = `${kindLabel} ${name} ${statusStr}`.trim();

        st.tools += line + '\n';
        if (!st.sections.tools) st.sections.tools = true;

        // 按 toolCallId 更新现有时间线条目，或推送新条目
        let existing: TimelineEvent | undefined;
        for (let i = st.timeline.length - 1; i >= 0; i--) {
          if (st.timeline[i]!.type === 'tool_call' && st.timeline[i]!.toolCallId === tc.toolCallId) {
            existing = st.timeline[i];
            break;
          }
        }
        if (existing) {
          existing.content = line;
        } else {
          st.timeline.push({ type: 'tool_call', content: line, toolCallId: tc.toolCallId });
        }
        break;
      }
      case 'plan': {
        st.reply += `\n[计划更新]\n`;
        break;
      }
      default:
        break;
    }
  }

  getStreamState(moduleName: string): StreamAccumulator | undefined {
    return this.streamState.get(moduleName);
  }

  finishStream(moduleName: string): StreamAccumulator | undefined {
    const st = this.streamState.get(moduleName);
    if (!st) return undefined;
    st.finished = true;
    return st;
  }

  cancelStream(moduleName: string): StreamAccumulator | undefined {
    const st = this.streamState.get(moduleName);
    if (!st) return undefined;
    st.finished = true;
    return st;
  }

  stopStream(moduleName: string): void {
    this.streamState.delete(moduleName);
  }

  // ── Context persistence ──

  private _safeName(moduleName: string): string {
    return moduleName.replace(/[<>:"/\\|?*]/g, '_');
  }

  async saveContext(moduleName: string, msgs: ChatMsg[]): Promise<void> {
    try {
      await this.initContextDir();
      const capped = this._capMessages(moduleName, msgs);
      const json = JSON.stringify(capped, null, 2);
      const finalPath = path.join(this.contextBaseDir, `${this._safeName(moduleName)}.json`);
      await fs.writeFile(finalPath, json, 'utf-8');
    } catch (err) {
      defaultLogger.warn(`[SessionStore] saveContext failed for [${moduleName}]: ${(err as Error).message}`);
    }
  }

  /**
   * 磁盘封顶：消息数超 maxMessages 或序列化后超 maxBytes 时从头部裁剪，
   * 被裁掉的消息追加到 archives/<module>/context-overflow.jsonl。
   */
  private _capMessages(moduleName: string, msgs: ChatMsg[]): ChatMsg[] {
    let result = msgs;

    if (result.length > this.maxMessages) {
      const overflow = result.slice(0, result.length - this.maxMessages);
      result = result.slice(-this.maxMessages);
      this._archiveOverflow(moduleName, overflow);
      defaultLogger.info(
        `[SessionStore] [${moduleName}] capped context: dropped ${overflow.length} msgs (max=${this.maxMessages})`,
      );
    }

    let size = JSON.stringify(result).length;
    if (size > this.maxBytes) {
      const removed: ChatMsg[] = [];
      while (result.length > 1 && size > this.maxBytes) {
        removed.push(result[0]!);
        result = result.slice(1);
        size = JSON.stringify(result).length;
      }
      if (removed.length > 0) {
        this._archiveOverflow(moduleName, removed);
        defaultLogger.info(
          `[SessionStore] [${moduleName}] capped context: dropped ${removed.length} msgs (maxBytes=${this.maxBytes})`,
        );
      }
    }

    return result;
  }

  private _archiveOverflow(moduleName: string, msgs: ChatMsg[]): void {
    if (msgs.length === 0) return;
    const file = path.join(this.archiveBaseDir, this._safeName(moduleName), 'context-overflow.jsonl');
    const lines = msgs.map((m) => JSON.stringify(m)).join('\n') + '\n';
    fs.mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.appendFile(file, lines, 'utf-8'))
      .catch((err) =>
        defaultLogger.warn(`[SessionStore] archive overflow failed for [${moduleName}]: ${(err as Error).message}`),
      );
  }

  async loadContext(moduleName: string): Promise<ChatMsg[]> {
    try {
      const filePath = path.join(this.contextBaseDir, `${this._safeName(moduleName)}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      const result = JSON.parse(raw) as ChatMsg[];
      if (result.length > 0) {
        defaultLogger.info(`[SessionStore] loaded ${result.length} msgs for [${moduleName}]`);
      }
      return result;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        defaultLogger.warn(`[SessionStore] loadContext failed for [${moduleName}]: ${(err as Error).message}`);
      }
      return [];
    }
  }

  async clearContext(moduleName: string): Promise<void> {
    try {
      const filePath = path.join(this.contextBaseDir, `${this._safeName(moduleName)}.json`);
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        defaultLogger.warn(`[SessionStore] clearContext failed for [${moduleName}]: ${(err as Error).message}`);
      }
    }
  }

  async clearAllContexts(): Promise<void> {
    try {
      const entries = await fs.readdir(this.contextBaseDir);
      const jsonFiles = entries.filter(e => e.endsWith('.json'));
      await Promise.all(jsonFiles.map(f => fs.unlink(path.join(this.contextBaseDir, f)).catch(() => {})));
    } catch (err) {
      defaultLogger.warn(`[SessionStore] clearAllContexts failed: ${(err as Error).message}`);
    }
  }
}
