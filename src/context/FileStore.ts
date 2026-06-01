// ---------------------------------------------------------------------------
// context/FileStore.ts — 文件系统上下文存储
// 将对话消息持久化为 JSON 文件，实现 ContextStore 接口
// ---------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import type { ChatMsg, ContextStore } from './ContextManager.js';
import { defaultLogger as log } from '../core/Logger.js';

export class FileStore implements ContextStore {
  private baseDir: string;

  constructor(projectRoot: string) {
    this.baseDir = path.join(projectRoot, '.module-agent', 'contexts');
    log.debug(`FileStore baseDir: ${this.baseDir}`);
  }

  private filePath(moduleName: string): string {
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    return path.join(this.baseDir, `${moduleName}.json`);
  }

  load(moduleName: string): ChatMsg[] {
    try {
      const fp = this.filePath(moduleName);
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        const msgs = JSON.parse(raw) as ChatMsg[];
        log.debug(`FileStore load: ${moduleName} (${msgs.length} msgs, ${raw.length} bytes)`);
        return msgs;
      }
    } catch (err) {
      log.error(`FileStore load error: ${moduleName} | ${(err as Error).message}`);
    }
    return [];
  }

  save(moduleName: string, msgs: ChatMsg[]): void {
    try {
      const fp = this.filePath(moduleName);
      const data = JSON.stringify(msgs, null, 2);
      fs.writeFileSync(fp, data, 'utf-8');
      log.debug(`FileStore save: ${moduleName} (${msgs.length} msgs, ${data.length} bytes)`);
    } catch (err) {
      log.error(`FileStore save error: ${moduleName} | ${(err as Error).message}`);
    }
  }

  remove(moduleName: string): void {
    try {
      const fp = this.filePath(moduleName);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        log.debug(`FileStore remove: ${moduleName}`);
      }
    } catch (err) {
      log.error(`FileStore remove error: ${moduleName} | ${(err as Error).message}`);
    }
  }

  list(): string[] {
    try {
      if (!fs.existsSync(this.baseDir)) return [];
      return fs.readdirSync(this.baseDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch (err) {
      log.error(`FileStore list error: ${(err as Error).message}`);
      return [];
    }
  }
}
