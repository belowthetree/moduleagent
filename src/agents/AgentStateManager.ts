import fs from 'fs/promises';
import path from 'path';

import type { ChatMsg, TimelineEvent } from '../types/shared.js';

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

// ── AgentStateManager ──

export class AgentStateManager {
  private readonly contextBaseDir: string;
  private readonly streamState: Map<string, StreamAccumulator>;
  private readonly contextMap: Map<string, ChatMsg[]>;

  constructor(contextBaseDir: string) {
    this.contextBaseDir = contextBaseDir;
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

  async saveContext(moduleName: string, msgs: ChatMsg[]): Promise<void> {
    try {
      await this.initContextDir();
      const json = JSON.stringify(msgs);
      const tmpPath = path.join(this.contextBaseDir, `${moduleName}.json.tmp`);
      const finalPath = path.join(this.contextBaseDir, `${moduleName}.json`);
      await fs.writeFile(tmpPath, json, 'utf-8');
      await fs.rename(tmpPath, finalPath);
    } catch {
    }
  }

  async loadContext(moduleName: string): Promise<ChatMsg[]> {
    try {
      const filePath = path.join(this.contextBaseDir, `${moduleName}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as ChatMsg[];
    } catch {
      return [];
    }
  }

  async clearContext(moduleName: string): Promise<void> {
    try {
      const filePath = path.join(this.contextBaseDir, `${moduleName}.json`);
      await fs.unlink(filePath);
    } catch {
    }
  }

  async clearAllContexts(): Promise<void> {
    try {
      const entries = await fs.readdir(this.contextBaseDir);
      const jsonFiles = entries.filter(e => e.endsWith('.json'));
      await Promise.all(jsonFiles.map(f => fs.unlink(path.join(this.contextBaseDir, f)).catch(() => {})));
    } catch {
    }
  }
}
