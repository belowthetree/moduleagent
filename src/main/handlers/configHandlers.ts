// ============================================================================
// configHandlers — 配置 IPC handler
// 读写 .module-agent.json 项目配置文件
// ============================================================================

import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { IpcChannel } from '../../protocol/IpcChannels.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { WorkspaceConfigSchema } from '../../config/schema.js';
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
    // 深拷贝：load 失败回落时返回的是共享默认对象，直接改会污染进程内其他项目的默认值
    workspaceConfig = structuredClone(workspaceConfig);
    const config = ConfigLoader.getDefaultConfig(workspaceConfig);
    if (updates.provider) config.agents.default.provider = updates.provider;
    if (updates.apiKey !== undefined) config.agents.default.apiKey = updates.apiKey;
    if (updates.baseUrl !== undefined) config.agents.default.baseUrl = updates.baseUrl;
    if (updates.model) config.agents.default.model = updates.model;
    if (updates.projectPath !== undefined) config.projectPath = updates.projectPath;
    if (updates.summarizationEnabled !== undefined) {
      config.summarization = { enabled: updates.summarizationEnabled };
    }
    // 写入前先经 zod 校验：无效配置拒绝写盘，并向渲染层返回可读错误
    const parsed = WorkspaceConfigSchema.safeParse(workspaceConfig);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      ctx.logger.error(`config:save rejected (invalid config): ${detail}`);
      return { success: false, error: `配置校验失败，未写入: ${detail}` };
    }
    await fs.promises.writeFile(configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
    if (updates.summarizationEnabled !== undefined) {
      ctx.summarizationEnabled = updates.summarizationEnabled;
    }
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
