// ============================================================================
// contextHandlers — 上下文 IPC handler
// 注册通道: context:get / context:clear / context:clearAll
// 委托给 core.modules（AgentStateManager 已移入 Core）
// ============================================================================

import { ipcMain } from 'electron';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerContextHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Context.Get, async (_event, moduleName: string) => {
    return ctx.core.modules.loadContext(moduleName);
  });

  ipcMain.handle(IpcChannel.Context.Clear, async (_event, moduleName: string) => {
    await ctx.core.modules.clearModuleContext(moduleName);
  });

  ipcMain.handle(IpcChannel.Context.ClearAll, async () => {
    await ctx.core.modules.clearAllContexts();
  });
}
