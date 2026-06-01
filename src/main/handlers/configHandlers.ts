// ============================================================================
// configHandlers — 配置 IPC handler
// 注册通道: config:save / config:get
// 读写 .module-agent.json 项目配置文件
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerConfigHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IpcChannel.Config.Save, async (_event, projectRoot: string, updates: { command?: string; args?: string[]; projectPath?: string; summarizationEnabled?: boolean }) => {
    const configPath = path.join(projectRoot, '.module-agent.json');
    let workspaceConfig;
    try {
      workspaceConfig = await ConfigLoader.load(projectRoot);
    } catch {
      workspaceConfig = { configs: [{ name: 'default', ...DEFAULT_CONFIG }], defaultConfig: 'default' };
    }
    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    if (updates.command) config.agents.default.command = updates.command;
    if (updates.args) config.agents.default.args = updates.args;
    if (updates.projectPath !== undefined) config.projectPath = updates.projectPath;
    if (updates.summarizationEnabled !== undefined) {
      config.summarization = { enabled: updates.summarizationEnabled };
      ctx.summarizationEnabled = updates.summarizationEnabled;
    }
    await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
    ctx.logger.info(`config:save wrote to ${configPath}`);
    return { success: true };
  });

  ipcMain.handle(IpcChannel.Config.Get, async (_event, projectRoot: string) => {
    try {
      const workspaceConfig = await ConfigLoader.load(projectRoot);
      const config = ConfigLoader.getDefaultConfig(workspaceConfig);
      return {
        command: config.agents.default.command,
        args: config.agents.default.args || [],
        projectPath: config.projectPath,
        summarizationEnabled: config.summarization?.enabled ?? false,
      };
    } catch {
      return {
        command: DEFAULT_CONFIG.agents.default.command,
        args: DEFAULT_CONFIG.agents.default.args || [],
        projectPath: DEFAULT_CONFIG.projectPath,
        summarizationEnabled: false,
      };
    }
  });
}
