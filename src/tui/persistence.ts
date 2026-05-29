import path from 'path';
import fs from 'fs-extra';
import { defaultLogger } from '../core/Logger.js';
import type { ChatMessage, MessageType } from './types.js';

// ── 持久化格式 ──

interface PersistedMessage {
  id: string;
  role: string;
  msgType: MessageType;
  content: string;
  time: string;
}

interface SessionFile {
  moduleName: string;
  savedAt: string;
  messages: PersistedMessage[];
}

// ── TUI 持久化管理器 ──

export class TuiPersistence {
  private sessionsDir: string;

  constructor(projectRoot: string) {
    this.sessionsDir = path.join(projectRoot, '.module-agent', 'tui_sessions');
  }

  /** 保存当前对话 */
  async save(moduleName: string, messages: ChatMessage[]): Promise<void> {
    await fs.ensureDir(this.sessionsDir);
    const file: SessionFile = {
      moduleName,
      savedAt: new Date().toISOString(),
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        msgType: m.msgType,
        content: m.content,
        time: m.time || '',
      })),
    };
    const fp = this._filePath(moduleName);
    await fs.writeFile(fp, JSON.stringify(file, null, 2), 'utf-8');
    defaultLogger.info(`TuiPersistence: saved ${messages.length} msgs for [${moduleName}]`);
  }

  /** 加载历史对话 */
  async load(moduleName: string): Promise<ChatMessage[]> {
    const fp = this._filePath(moduleName);
    if (!(await fs.pathExists(fp))) return [];
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const file: SessionFile = JSON.parse(raw);
      defaultLogger.info(`TuiPersistence: loaded ${file.messages.length} msgs for [${moduleName}]`);
      return file.messages.map(m => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        msgType: m.msgType,
        content: m.content,
        time: m.time,
      }));
    } catch (err) {
      defaultLogger.warn(`TuiPersistence: failed to load [${moduleName}]: ${(err as Error).message}`);
      return [];
    }
  }

  /** 删除对话 */
  async remove(moduleName: string): Promise<void> {
    const fp = this._filePath(moduleName);
    if (await fs.pathExists(fp)) {
      await fs.remove(fp);
      defaultLogger.info(`TuiPersistence: removed [${moduleName}]`);
    }
  }

  /** 列出所有已保存的会话 */
  async list(): Promise<string[]> {
    await fs.ensureDir(this.sessionsDir);
    try {
      const files = await fs.readdir(this.sessionsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  /** 获取会话摘要 */
  async getSummary(moduleName: string): Promise<{ messageCount: number; savedAt: string } | null> {
    const fp = this._filePath(moduleName);
    if (!(await fs.pathExists(fp))) return null;
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const file: SessionFile = JSON.parse(raw);
      return { messageCount: file.messages.length, savedAt: file.savedAt };
    } catch {
      return null;
    }
  }

  private _filePath(moduleName: string): string {
    const safe = moduleName.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(this.sessionsDir, `${safe}.json`);
  }
}

/** 历史输入持久化 */
export class InputHistoryPersistence {
  private filePath: string;

  constructor(projectRoot: string) {
    const dir = path.join(projectRoot, '.module-agent');
    this.filePath = path.join(dir, 'tui_input_history.json');
  }

  async load(): Promise<string[]> {
    try {
      if (await fs.pathExists(this.filePath)) {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        return JSON.parse(raw) as string[];
      }
    } catch { /* ignore */ }
    return [];
  }

  async save(history: string[]): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.filePath));
      // 最多保存 100 条
      const trimmed = history.slice(-100);
      await fs.writeFile(this.filePath, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }
}
