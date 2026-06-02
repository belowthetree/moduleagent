// ============================================================================
// roleHandlers — 角色 Agent IPC handler
// 注册通道: role:list / role:save / role:delete / role:start / role:send / role:cancel / role:stop / role:isRunning / role:getContext / role:clearContext
//
// 状态管理（锁、流累积、上下文保存）已移入 Core 层。
// Handler 仅负责 IPC 编解码 + 委托给 core.roles。
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { HandlerContext } from './HandlerContext.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { cleanupRoleWorkspace } from '../../agents/RoleWorkspace.js';
import { configExplorer } from '../../core/ConfigPaths.js';
import type { RoleConfig } from '../../config/defaults.js';

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
    if (existing) return { sessionId: existing.agent.sessionId };
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
    // 委托给 Core — 锁、流、保存、后处理均在 core.roles.sendMessage 内完成
    return ctx.core.roles.sendMessage(roleName, text);
  });

  ipcMain.handle(IpcChannel.Role.Cancel, async (_event, roleName: string) => {
    const entry = ctx.core.roles?.getAgent(roleName);
    if (entry) {
      try { await entry.agent.cancel(); } catch { /* 忽略 */ }
    }
    const ctxKey = `workrole:${roleName}`;
    const acc = ctx.core.modules.cancelStream(ctxKey);
    return { accumulated: acc };
  });

  ipcMain.handle(IpcChannel.Role.Stop, async (_event, roleName: string) => {
    await ctx.core.roles?.stopRole(roleName);
    const ctxKey = `workrole:${roleName}`;
    ctx.core.modules.stopStream(ctxKey);
    return {};
  });

  ipcMain.handle(IpcChannel.Role.IsRunning, (_event, roleName: string) => {
    return ctx.core.roles?.getAgent(roleName) !== undefined;
  });

  ipcMain.handle(IpcChannel.Role.GetContext, async (_event, roleName: string) => {
    const ctxKey = `workrole:${roleName}`;
    return ctx.core.modules.loadContext(ctxKey);
  });

  ipcMain.handle(IpcChannel.Role.ClearContext, async (_event, roleName: string) => {
    const ctxKey = `workrole:${roleName}`;
    await ctx.core.modules.clearModuleContext(ctxKey);
  });
}
