// ============================================================================
// migrationHandlers — 数据迁移 IPC handler
// 注册通道: migrate:check / migrate:data
// 将旧版 localStorage 上下文迁移到 AgentStateManager 文件存储
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import type { ChatMsg } from '../../types/shared.js';

export function registerMigrationHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Migrate.Check, async (_event, keys: string[]) => {
    if (!ctx.stateManager) return { needed: [], streamNeeded: false };
    const needed: string[] = [];
    for (const key of keys) {
      if (key.startsWith('ctx_')) {
        const moduleName = key.slice(4);
        const existing = await ctx.stateManager.loadContext(moduleName);
        if (existing.length === 0) needed.push(key);
      }
    }
    const streamNeeded = keys.includes('stream_snapshot');
    return { needed, streamNeeded };
  });

  ipcMain.handle(IpcChannel.Migrate.Data, async (_event, payload: { moduleName: string; msgs: ChatMsg[] }) => {
    if (!ctx.stateManager) return;
    await ctx.stateManager.saveContext(payload.moduleName, payload.msgs);
  });
}
