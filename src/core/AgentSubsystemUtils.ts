// ---------------------------------------------------------------------------
// AgentSubsystemUtils.ts — 子系统共享工具
// sendLock、context 持久化、知识路径解析 — 消除 Module/Role 子系统重复
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { SessionStore } from '../agents/StreamAccumulator.js';
import type { ChatMsg, TimelineEvent } from '../types/shared.js';

export interface StreamAccumulator {
  reply: string;
  thinking: string;
  tools: string;
  timeline?: TimelineEvent[];
}

export class SendGuard {
  private chains = new Map<string, Promise<void>>();

  /**
   * 标准 promise-chain mutex：同一 name 的获取严格串行。
   * 每个等待者挂在前序持有者的链尾，只有自己前序释放后才获得锁，
   * ≥3 个并发等待者时也不会出现同时"持锁"。
   */
  async acquire(name: string): Promise<() => void> {
    const prev = this.chains.get(name) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((r) => { release = r; });
    // 链尾 = 前序释放 + 自己释放后才完成
    const tail = prev.then(() => current);
    this.chains.set(name, tail);
    // 等待前序持有者释放（链上 promise 只 resolve 不 reject）
    await prev;
    return () => {
      release();
      // 仅当没有后续等待者时清理，避免 Map 无限增长
      if (this.chains.get(name) === tail) {
        this.chains.delete(name);
      }
    };
  }

  clear(): void {
    this.chains.clear();
  }
}

export async function persistContext(
  stateManager: SessionStore | null,
  key: string,
  userText: string,
  acc: StreamAccumulator,
): Promise<ChatMsg[]> {
  const timeStr = new Date().toLocaleTimeString();
  const userMsg: ChatMsg = {
    id: 'u' + Date.now().toString(36),
    role: 'user',
    content: userText,
    thinking: '',
    time: timeStr,
    status: 'sent',
    moduleName: key,
  };
  const agentMsg: ChatMsg = {
    id: 'm' + (Date.now() + 1).toString(36),
    role: 'agent',
    content: acc.reply || '',
    thinking: acc.thinking || '',
    timeline: acc.timeline || [],
    time: timeStr,
    status: 'completed',
    moduleName: key,
  };
  const existing = await stateManager?.loadContext(key) ?? [];
  existing.push(userMsg, agentMsg);
  await stateManager?.saveContext(key, existing);
  return existing;
}

export function resolveKnowledgePath(projectPath: string, filename: string): string | null {
  const dirs = [
    path.join(projectPath, '.module-agent', 'knowledge'),
    path.join(os.homedir(), '.module-agent', 'config', 'knowledge'),
  ];
  for (const dir of dirs) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}
