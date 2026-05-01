import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import type { ChatMsg, ContextStore } from './ContextManager.js';

export class FileStore implements ContextStore {
  private baseDir: string;

  constructor(projectRoot: string) {
    const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
    this.baseDir = path.join(os.homedir(), '.module-agent', 'contexts', hash);
  }

  private filePath(moduleName: string): string {
    if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });
    return path.join(this.baseDir, `${moduleName}.json`);
  }

  load(moduleName: string): ChatMsg[] {
    try {
      const fp = this.filePath(moduleName);
      if (fs.existsSync(fp)) {
        return JSON.parse(fs.readFileSync(fp, 'utf-8')) as ChatMsg[];
      }
    } catch {}
    return [];
  }

  save(moduleName: string, msgs: ChatMsg[]): void {
    try {
      fs.writeFileSync(this.filePath(moduleName), JSON.stringify(msgs, null, 2), 'utf-8');
    } catch {}
  }

  remove(moduleName: string): void {
    try {
      const fp = this.filePath(moduleName);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
  }

  list(): string[] {
    try {
      if (!fs.existsSync(this.baseDir)) return [];
      return fs.readdirSync(this.baseDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }
}
