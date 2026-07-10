// ---------------------------------------------------------------------------
// AgentSubsystemUtils.ts — 子系统共享工具
// sendLock、context 持久化、知识路径解析 — 消除 Module/Role 子系统重复
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentStateManager } from '../agents/AgentStateManager.js';
import type { ChatMsg, TimelineEvent } from '../types/shared.js';

export interface StreamAccumulator {
  reply: string;
  thinking: string;
  tools: string;
  timeline?: TimelineEvent[];
}

export class SendGuard {
  private locks = new Map<string, Promise<void>>();

  async acquire(name: string): Promise<() => void> {
    const prev = this.locks.get(name);
    if (prev) {
      try { await prev; } catch { /* 忽略 */ }
    }
    let release: () => void = () => {};
    this.locks.set(name, new Promise<void>((r) => { release = r; }));
    return () => {
      release();
      this.locks.delete(name);
    };
  }

  clear(): void {
    this.locks.clear();
  }
}

export async function persistContext(
  stateManager: AgentStateManager | null,
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
