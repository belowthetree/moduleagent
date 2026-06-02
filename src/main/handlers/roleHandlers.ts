// ============================================================================
// roleHandlers — 角色 Agent IPC handler
// 注册通道: role:list / role:save / role:delete / role:start / role:send / role:cancel / role:stop / role:isRunning / role:getContext / role:clearContext
// 管理角色 Agent 的完整生命周期（CRUD + 启动→发送→取消→停止）
// role:send 通过 sendPipeline 执行公共 send 管道
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { cleanupRoleWorkspace } from '../../agents/RoleWorkspace.js';
import { configExplorer } from '../../core/ConfigPaths.js';
import type { RoleConfig } from '../../config/defaults.js';
import type { ChatMsg } from '../../types/shared.js';

export function registerRoleHandlers(ctx: HandlerContext): void {

  ipcMain.handle(IpcChannel.Role.List, async () => {
    try {
      const workspaceConfig = await ConfigLoader.load(ctx.core.getProjectRoot() || process.cwd());
      return workspaceConfig.roles || [];
    } catch {
      return [];
    }
  });

  ipcMain.handle(IpcChannel.Role.Save, async (_event, role: RoleConfig) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false };
    try {
      const configPath = path.join(projectRoot, '.module-agent.json');
      let workspaceConfig = await ConfigLoader.load(projectRoot);
      if (!workspaceConfig.roles) workspaceConfig.roles = [];
      const idx = workspaceConfig.roles.findIndex(r => r.name === role.name);
      if (idx >= 0) {
        workspaceConfig.roles[idx] = role;
      } else {
        workspaceConfig.roles.push(role);
      }
      await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
      configExplorer.clearCaches();
      return { success: true };
    } catch (err) {
      ctx.logger.error(`role:save failed: ${(err as Error).message}`);
      return { success: false };
    }
  });

  ipcMain.handle(IpcChannel.Role.Delete, async (_event, name: string) => {
    const projectRoot = ctx.core.getProjectRoot();
    if (!projectRoot) return { success: false };
    try {
      const configPath = path.join(projectRoot, '.module-agent.json');
      let workspaceConfig = await ConfigLoader.load(projectRoot);
      if (workspaceConfig.roles) {
        workspaceConfig.roles = workspaceConfig.roles.filter(r => r.name !== name);
      }
      await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
      configExplorer.clearCaches();

      const workspaceRoot = path.join(projectRoot, '.module-agent', 'workspace');
      await cleanupRoleWorkspace(name, workspaceRoot);
      await ctx.core.roles?.stopRole(name);
      return { success: true };
    } catch (err) {
      ctx.logger.error(`role:delete failed: ${(err as Error).message}`);
      return { success: false };
    }
  });

  ipcMain.handle(IpcChannel.Role.Start, async (_event, roleName: string) => {
    if (!ctx.core.roles) return { error: 'no role agent manager' };
    const existing = ctx.core.roles.getAgent(roleName);
    if (existing) return { sessionId: existing.sessionId };
    try {
      const workspaceConfig = await ConfigLoader.load(ctx.core.getProjectRoot());
      const role = workspaceConfig.roles?.find(r => r.name === roleName);
      if (!role) return { error: `role not found: ${roleName}` };
      const entry = await ctx.core.roles.startRole(role);
      return { sessionId: entry.agent.sessionId };
    } catch (err) {
      ctx.logger.error(`role:start failed [${roleName}]: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle(IpcChannel.Role.Send, async (_event, roleName: string, text: string) => {
    if (!ctx.core.roles) return { error: 'no role agent manager' };

    const prevLock = ctx.roleSendLock.get(roleName);
    if (prevLock) try { await prevLock; } catch { /* 继续 */ }
    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(r => { resolveLock = r; });
    ctx.roleSendLock.set(roleName, lockPromise);

    try {
      // 确保 Agent 已启动（通常通过 role:start 启动，但在此做保护）
      let entry = ctx.core.roles.getAgent(roleName);
      if (!entry) {
        const workspaceConfig = await ConfigLoader.load(ctx.core.getProjectRoot());
        const role = workspaceConfig.roles?.find(r => r.name === roleName);
        if (!role) return { error: `role not found: ${roleName}` };
        entry = await ctx.core.roles.startRole(role);
      }

      const ctxKey = `workrole:${roleName}`;
      ctx.stateManager?.startStream(ctxKey);

      const promptBlocks = ctx.core.roles!.buildPromptBlocks(roleName, text);
      ctx.logger.info(`role:send [${roleName}] len=${text.length}`);
      const result = await entry.agent.connection.prompt({
        sessionId: entry.agent.sessionId,
        prompt: promptBlocks,
      });

      const acc = ctx.stateManager?.finishStream(ctxKey);

      const timeStr = new Date().toLocaleTimeString();
      const userMsg: ChatMsg = {
        id: 'r' + Date.now().toString(36),
        role: 'user',
        content: text,
        thinking: '',
        time: timeStr,
        status: 'sent',
        moduleName: ctxKey,
      };
      const agentMsg: ChatMsg = {
        id: 'r' + (Date.now() + 1).toString(36),
        role: 'agent',
        content: acc?.reply || '',
        thinking: acc?.thinking || '',
        timeline: acc?.timeline || [],
        time: timeStr,
        status: 'completed',
        moduleName: ctxKey,
      };
      const existingMsgs = await ctx.stateManager?.loadContext(ctxKey) ?? [];
      existingMsgs.push(userMsg, agentMsg);
      await ctx.stateManager?.saveContext(ctxKey, existingMsgs);

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
      ctx.logger.error(`role:send failed [${roleName}]: ${(err as Error).message}`);
      const ctxKey = `workrole:${roleName}`;
      ctx.stateManager?.stopStream(ctxKey);
      return { error: (err as Error).message };
    } finally {
      resolveLock();
      ctx.roleSendLock.delete(roleName);
    }
  });

  ipcMain.handle(IpcChannel.Role.Cancel, async (_event, roleName: string) => {
    const entry = ctx.core.roles?.getAgent(roleName);
    if (entry) {
      try { await entry.agent.cancel(); } catch { /* 忽略 */ }
    }
    const ctxKey = `workrole:${roleName}`;
    const acc = ctx.stateManager?.cancelStream(ctxKey);
    return { accumulated: acc };
  });

  ipcMain.handle(IpcChannel.Role.Stop, async (_event, roleName: string) => {
    await ctx.core.roles?.stopRole(roleName);
    const ctxKey = `workrole:${roleName}`;
    ctx.stateManager?.stopStream(ctxKey);
    return {};
  });

  ipcMain.handle(IpcChannel.Role.IsRunning, (_event, roleName: string) => {
    return ctx.core.roles?.getAgent(roleName) !== undefined;
  });

  ipcMain.handle(IpcChannel.Role.GetContext, async (_event, roleName: string) => {
    const ctxKey = `workrole:${roleName}`;
    return ctx.stateManager?.loadContext(ctxKey) ?? [];
  });

  ipcMain.handle(IpcChannel.Role.ClearContext, async (_event, roleName: string) => {
    const ctxKey = `workrole:${roleName}`;
    await ctx.stateManager?.clearContext(ctxKey);
  });
}
