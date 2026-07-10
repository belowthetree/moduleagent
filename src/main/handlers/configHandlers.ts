// ============================================================================
// configHandlers — 配置 IPC handler
// 读写 .module-agent.json 项目配置文件
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import type { HandlerContext } from './HandlerContext.js';

export function registerConfigHandlers(ctx: HandlerContext): void {
  ipcMain.handle(IpcChannel.Config.Save, async (_event, projectRoot: string, updates: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    projectPath?: string;
    summarizationEnabled?: boolean;
  }) => {
    const configPath = path.join(projectRoot, '.module-agent.json');
    let workspaceConfig;
    try {
      workspaceConfig = await ConfigLoader.load(projectRoot);
    } catch {
      workspaceConfig = { configs: [{ name: 'default', ...DEFAULT_CONFIG }], defaultConfig: 'default' };
    }
    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    if (updates.provider) config.agents.default.provider = updates.provider;
    if (updates.apiKey !== undefined) config.agents.default.apiKey = updates.apiKey;
    if (updates.baseUrl !== undefined) config.agents.default.baseUrl = updates.baseUrl;
    if (updates.model) config.agents.default.model = updates.model;
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
        provider: config.agents.default.provider,
        apiKey: config.agents.default.apiKey,
        baseUrl: config.agents.default.baseUrl,
        model: config.agents.default.model,
        projectPath: config.projectPath,
        summarizationEnabled: config.summarization?.enabled ?? false,
      };
    } catch {
      return {
        provider: DEFAULT_CONFIG.agents.default.provider,
        apiKey: DEFAULT_CONFIG.agents.default.apiKey,
        baseUrl: DEFAULT_CONFIG.agents.default.baseUrl,
        model: DEFAULT_CONFIG.agents.default.model,
        projectPath: DEFAULT_CONFIG.projectPath,
        summarizationEnabled: false,
      };
    }
  });
}
