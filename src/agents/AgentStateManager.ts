import fs from 'fs/promises';
import path from 'path';

import type { ChatMsg } from '../types/preload.js';

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
  finished?: boolean;
  sections: StreamSection;
}

// ── Default factory ──

function createStreamAccumulator(): StreamAccumulator {
  return {
    reply: '',
    thinking: '',
    tools: '',
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
        const block = (data as { content?: { type?: string; text?: string } }).content;
        const text = block?.type === 'text' ? block.text : undefined;
        if (text) {
          st.reply += text;
          if (!st.sections.reply) st.sections.reply = true;
        }
        break;
      }
      case 'agent_thought_chunk': {
        const block = (data as { content?: { type?: string; text?: string } }).content;
        const text = block?.type === 'text' ? block.text : undefined;
        if (text) {
          st.thinking += text;
          if (!st.sections.thinking) st.sections.thinking = true;
        }
        break;
      }
      case 'tool_call': {
        const tc = data as {
          title?: string;
          toolCallId: string;
          kind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
          status?: 'pending' | 'in_progress' | 'completed' | 'failed';
        };
        const kindLabel = tc.kind ? `[${tc.kind}]` : '';
        const name = tc.title || tc.toolCallId || 'unknown';
        const line = `${kindLabel} ${name} ${tc.status ? `(${tc.status})` : ''}`.trim();
        st.tools += line + '\n';
        if (!st.sections.tools) st.sections.tools = true;
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
