// ============================================================================
// agentHandlers — 模块 Agent IPC handler
// 注册通道: agent:start / agent:send / agent:cancel / agent:stop / agent:isRunning / agent:getRunning
//
// 状态管理（锁、流累积、上下文保存、状态追踪）已移入 Core 层。
// Handler 仅负责 IPC 编解码 + 委托给 core.modules。
// ============================================================================

import { ipcMain } from 'electron';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerAgentHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Agent.Start, async (_event, moduleName: string) => {
    if (!ctx.core.isInitialized()) return { error: 'no module graph loaded' };
    const existing = ctx.core.modules.getAgent(moduleName);
    if (existing) return { sessionId: existing.agent.sessionId };
    try {
      const entry = await ctx.core.modules.startAgent(moduleName);
      return { sessionId: entry.agent.sessionId };
    } catch (err) {
      ctx.logger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Agent.Send, async (_event, moduleName: string, text: string) => {
    if (!ctx.core.isInitialized()) return { error: 'no module graph loaded' };
    // 委托给 Core — 锁、流、保存、后处理均在 core.modules.sendMessage 内完成
    return ctx.core.modules.sendMessage(text, moduleName);
  });

  ipcMain.handle(IpcChannel.Agent.Cancel, async (_event, moduleName: string) => {
    const entry = ctx.core.modules.getAgent(moduleName);
    if (entry) {
      const result = await entry.agent.cancel();
      if (result === 'stopped') {
        ctx.core.modules.deleteAgentStatus(moduleName);
      } else {
        ctx.core.modules.setAgentStatus(moduleName, 'idle');
      }
    }
    const acc = ctx.core.modules.cancelStream(moduleName);
    return { accumulated: acc };
  });

  ipcMain.handle(IpcChannel.Agent.Stop, async (_event, moduleName: string) => {
    const entry = ctx.core.modules.getAgent(moduleName);
    if (entry) {
      entry.agent.stop();
      ctx.core.modules.deleteAgentStatus(moduleName);
    }
    ctx.core.modules.stopStream(moduleName);
    return {};
  });

  ipcMain.handle(IpcChannel.Agent.IsRunning, (_event, moduleName: string) => {
    return ctx.core.modules.getAgent(moduleName) !== undefined;
  });

  ipcMain.handle(IpcChannel.Agent.GetRunning, () => {
    return ctx.core.modules.listAgentStatuses();
  });
}
