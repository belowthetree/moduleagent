// ============================================================================
// agentHandlers — 模块 Agent IPC handler
// 注册通道: agent:start / agent:send / agent:cancel / agent:stop / agent:isRunning / agent:getRunning
// 管理模块 Agent 的完整生命周期（启动→发送→取消→停止）
// agent:send 通过 sendPipeline 执行公共 send 管道
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { buildPromptBlocks } from '../../agents/PromptBuilder.js';
import type { ChatMsg } from '../../types/shared.js';

export function registerAgentHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Agent.Start, async (_event, moduleName: string) => {
    if (!ctx.core.isInitialized()) return { error: 'no module graph loaded' };
    const existing = ctx.core.modules.getAgent(moduleName);
    if (existing) return { sessionId: existing.sessionId };
    try {
      const entry = await ctx.core.modules.startAgent(moduleName);
      return { sessionId: entry.agent.sessionId };
    } catch (err) {
      ctx.logger.error(`agent:start failed [${moduleName}]: ${(err as Error).message}`);
      ctx.agentStatus.set(moduleName, 'error');
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'error' });
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Agent.Send, async (_event, moduleName: string, text: string) => {
    if (!ctx.core.isInitialized()) return { error: 'no module graph loaded' };

    const prevLock = ctx.sendLock.get(moduleName);
    if (prevLock) {
      try { await prevLock; } catch { /* 继续 */ }
    }
    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(r => { resolveLock = r; });
    ctx.sendLock.set(moduleName, lockPromise);

    try {
      let entry = ctx.core.modules.getAgent(moduleName);
      if (!entry) {
        entry = await ctx.core.modules.startAgent(moduleName);
      }

      ctx.agentStatus.set(moduleName, 'streaming');
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'streaming' });

      const promptBlocks = buildPromptBlocks({
        moduleName,
        userText: text,
        graph: ctx.core.getGraph()!,
        prompts: ctx.prompts,
        sessionPrompted: new Set(),
      });

      ctx.stateManager?.startStream(moduleName);

      ctx.logger.info(`agent:send [${moduleName}] len=${text.length} blocks=${promptBlocks.length}`);
      const result = await entry.agent.connection.prompt({
        sessionId: entry.agent.sessionId,
        prompt: promptBlocks,
      });

      const acc = ctx.stateManager?.finishStream(moduleName);

      // 保存上下文
      const timeStr = new Date().toLocaleTimeString();
      const agentCmd = entry.agent.config.command || '';
      const userMsg: ChatMsg = {
        id: 'm' + Date.now().toString(36),
        role: 'user',
        content: text,
        thinking: '',
        time: timeStr,
        status: 'sent',
        moduleName,
        sessionId: entry.agent.sessionId,
      };
      const agentMsg: ChatMsg = {
        id: 'm' + (Date.now() + 1).toString(36),
        role: 'agent',
        content: acc?.reply || '',
        thinking: acc?.thinking || '',
        timeline: acc?.timeline || [],
        time: timeStr,
        status: 'completed',
        moduleName,
      };
      const existingMsgs = await ctx.stateManager?.loadContext(moduleName) ?? [];
      existingMsgs.push(userMsg, agentMsg);
      await ctx.stateManager?.saveContext(moduleName, existingMsgs);

      // 触发即忘的经验总结（后台执行）
      const projectRoot = ctx.core.getProjectRoot();
      if (projectRoot && ctx.summarizationEnabled) {
        ctx.logger.info(`Triggering summarizer for [${moduleName}]`);
        ctx.summarizer.summarize({
          moduleName,
          chatMsgs: existingMsgs,
          projectRoot,
          configDir: ctx.configDir,
          agentConfig: { command: entry.agent.config.command, args: entry.agent.config.args },
          agentCwd: entry.agent.cwd,
        }).catch(err => {
          ctx.logger.warn(`Summarizer error [${moduleName}]: ${(err as Error).message}`);
        });
      }

      // ── 触发工作区变更检测（后台异步） ──
      ctx._triggerWorkspaceDiff(moduleName, entry.agent.cwd, projectRoot);

      ctx.agentStatus.set(moduleName, 'idle');
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'idle' });

      return {
        result: {
          reply: acc?.reply || '',
          thinking: acc?.thinking || '',
          tools: acc?.tools || '',
          timeline: acc?.timeline || [],
          stopReason: result.stopReason,
        },
      };
    } catch (err) {
      ctx.logger.error(`agent:send failed [${moduleName}]: ${(err as Error).message}`);
      ctx.stateManager?.stopStream(moduleName);
      ctx.agentStatus.set(moduleName, 'error');
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'error' });
      return { error: (err as Error).message };
    } finally {
      resolveLock();
      ctx.sendLock.delete(moduleName);
    }
  });

  ipcMain.handle(IpcChannel.Agent.Cancel, async (_event, moduleName: string) => {
    const entry = ctx.core.modules.getAgent(moduleName);
    if (entry) {
      try { await entry.agent.cancel(); } catch { /* 忽略 */ }
      ctx.agentStatus.set(moduleName, 'idle');
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'idle' });
    }
    const acc = ctx.stateManager?.cancelStream(moduleName);
    return { accumulated: acc };
  });

  ipcMain.handle(IpcChannel.Agent.Stop, async (_event, moduleName: string) => {
    const entry = ctx.core.modules.getAgent(moduleName);
    if (entry) {
      entry.agent.stop();
      // 通过内部访问直接从 agents 映射中移除
      (ctx.core.modules as any).agents?.delete?.(moduleName);
      ctx.agentStatus.delete(moduleName);
      ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: moduleName, status: 'stopped' });
    }
    ctx.stateManager?.stopStream(moduleName);
    return {};
  });

  ipcMain.handle(IpcChannel.Agent.IsRunning, (_event, moduleName: string) => {
    return ctx.core.modules.getAgent(moduleName) !== undefined;
  });

  ipcMain.handle(IpcChannel.Agent.GetRunning, () => {
    return ctx.core.modules.listAgents().map(name => ({
      name,
      status: ctx.agentStatus.get(name) || 'idle',
    }));
  });
}
