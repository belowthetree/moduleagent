import { defaultLogger as log } from '../core/Logger.js';

export interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  content: string;
  thinking: string;
  time: string;
  status: string;
  moduleName: string;
  sessionId?: string;
}

export interface ContextStore {
  load(moduleName: string): ChatMsg[];
  save(moduleName: string, msgs: ChatMsg[]): void;
  remove(moduleName: string): void;
  list(): string[];
}

export class ContextManager {
  private cache = new Map<string, ChatMsg[]>();

  constructor(private store: ContextStore) {}

  getMessages(moduleName: string): ChatMsg[] {
    if (!this.cache.has(moduleName)) {
      const msgs = this.store.load(moduleName);
      this.cache.set(moduleName, msgs);
      log.info(`Context loaded: ${moduleName} (${msgs.length} msgs)`);
    }
    return this.cache.get(moduleName)!;
  }

  addMessage(moduleName: string, msg: ChatMsg): void {
    const msgs = this.getMessages(moduleName);
    msgs.push(msg);
    this.store.save(moduleName, msgs);
    log.info(`Context add: ${moduleName} role=${msg.role} (${msg.content.length} chars, total ${msgs.length} msgs)`);
  }

  clearModule(moduleName: string): void {
    this.cache.delete(moduleName);
    this.store.remove(moduleName);
    log.info(`Context cleared: ${moduleName}`);
  }

  clearAll(): void {
    for (const name of this.store.list()) {
      this.store.remove(name);
    }
    this.cache.clear();
    log.info(`Context cleared all`);
  }

  getModules(): string[] {
    return this.store.list();
  }
}

export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function timeStr(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
