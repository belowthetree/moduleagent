// ============================================================================
// contextHandlers — 上下文 IPC handler
// 注册通道: context:get / context:clear / context:clearAll
// 通过 AgentStateManager 读写 Agent 会话上下文
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerContextHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Context.Get, async (_event, moduleName: string) => {
    return ctx.stateManager?.loadContext(moduleName) ?? [];
  });

  ipcMain.handle(IpcChannel.Context.Clear, async (_event, moduleName: string) => {
    await ctx.stateManager?.clearContext(moduleName);
  });

  ipcMain.handle(IpcChannel.Context.ClearAll, async () => {
    await ctx.stateManager?.clearAllContexts();
  });
}
