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
    // TODO (Task 3): fs.promises.mkdir(this.contextBaseDir, { recursive: true })
    console.log(`[AgentStateManager] initContextDir: ${this.contextBaseDir}`);
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

  // ── Context persistence (stubs — implemented in Task 3) ──

  async saveContext(_moduleName: string, _msgs: ChatMsg[]): Promise<void> {
    // TODO (Task 3): atomic write to <contextBaseDir>/<moduleName>.json
  }

  async loadContext(_moduleName: string): Promise<ChatMsg[]> {
    // TODO (Task 3): read from <contextBaseDir>/<moduleName>.json
    return [];
  }

  async clearContext(_moduleName: string): Promise<void> {
    // TODO (Task 3): fs.promises.unlink(...)
  }

  async clearAllContexts(): Promise<void> {
    // TODO (Task 3): remove all files in contextBaseDir
  }
}
