// ---------------------------------------------------------------------------
// tui/persistence.ts — TUI 对话持久化
// 保存/加载 TUI 聊天消息和输入历史到 JSON 文件
// ---------------------------------------------------------------------------

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
    const filteredMsgs = messages.filter(m => m.content.trim());
    const file: SessionFile = {
      moduleName,
      savedAt: new Date().toISOString(),
      messages: filteredMsgs.map(m => ({
        id: m.id,
        role: m.role,
        msgType: m.msgType,
        content: m.content,
        time: m.time || '',
      })),
    };
    const fp = this._filePath(moduleName);
    await fs.writeFile(fp, JSON.stringify(file, null, 2), 'utf-8');
    defaultLogger.info(`TuiPersistence: saved ${filteredMsgs.length}/${messages.length} msgs for [${moduleName}] to ${fp}`);
  }

  /** 加载历史对话 */
  async load(moduleName: string): Promise<ChatMessage[]> {
    const fp = this._filePath(moduleName);
    if (!(await fs.pathExists(fp))) {
      defaultLogger.info(`TuiPersistence: no saved session at ${fp}`);
      return [];
    }
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const file: SessionFile = JSON.parse(raw);
      defaultLogger.info(`TuiPersistence: loaded ${file.messages.length} msgs for [${moduleName}] from ${fp}`);
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

  /** 将当前对话存档（保存到带时间戳的文件，然后清空当前会话） */
  async archive(moduleName: string, messages: ChatMessage[]): Promise<string> {
    await fs.ensureDir(this.sessionsDir);
    const filteredMsgs = messages.filter(m => m.content.trim());
    if (filteredMsgs.length === 0) {
      defaultLogger.info(`TuiPersistence: nothing to archive for [${moduleName}]`);
      // 仍清除当前会话文件
      await this.remove(moduleName);
      return '';
    }
    const timestamp = Date.now();
    const safe = moduleName.replace(/[<>:"/\\|?*]/g, '_');
    const archiveName = `${safe}.${timestamp}`;
    const fp = path.join(this.sessionsDir, `${archiveName}.json`);

    const file: SessionFile = {
      moduleName: archiveName,
      savedAt: new Date().toISOString(),
      messages: filteredMsgs.map(m => ({
        id: m.id,
        role: m.role,
        msgType: m.msgType,
        content: m.content,
        time: m.time || '',
      })),
    };
    await fs.writeFile(fp, JSON.stringify(file, null, 2), 'utf-8');
    defaultLogger.info(`TuiPersistence: archived ${filteredMsgs.length} msgs for [${moduleName}] → ${archiveName}.json`);

    // 删除当前会话文件，让新会话从零开始
    await this.remove(moduleName);
    return archiveName;
  }

  /** 删除对话 */
  async remove(moduleName: string): Promise<void> {
    const fp = this._filePath(moduleName);
    if (await fs.pathExists(fp)) {
      await fs.remove(fp);
      defaultLogger.info(`TuiPersistence: removed [${moduleName}]`);
    }
  }

  /** 列出所有已保存的会话（排除存档） */
  async list(): Promise<string[]> {
    await fs.ensureDir(this.sessionsDir);
    try {
      const files = await fs.readdir(this.sessionsDir);
      return files
        .filter(f => f.endsWith('.json') && !/\.\d+\.json$/.test(f))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  /** 列出指定模块的存档文件 */
  async listArchives(moduleName: string): Promise<string[]> {
    await fs.ensureDir(this.sessionsDir);
    const safe = moduleName.replace(/[<>:"/\\|?*]/g, '_');
    const prefix = `${safe}.`;
    try {
      const files = await fs.readdir(this.sessionsDir);
      return files
        .filter(f => f.startsWith(prefix) && f.endsWith('.json') && /\.\d+\.json$/.test(f))
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

  /** 按完整文件名加载（用于加载存档） */
  async loadByName(name: string): Promise<ChatMessage[]> {
    const fp = path.join(this.sessionsDir, `${name}.json`);
    if (!(await fs.pathExists(fp))) {
      defaultLogger.info(`TuiPersistence: no saved session at ${fp}`);
      return [];
    }
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const file: SessionFile = JSON.parse(raw);
      defaultLogger.info(`TuiPersistence: loaded ${file.messages.length} msgs from ${name}.json`);
      return file.messages.map(m => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        msgType: m.msgType,
        content: m.content,
        time: m.time,
      }));
    } catch (err) {
      defaultLogger.warn(`TuiPersistence: failed to load [${name}]: ${(err as Error).message}`);
      return [];
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
