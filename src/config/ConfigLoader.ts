// ---------------------------------------------------------------------------
// config/ConfigLoader.ts — 配置文件加载器
// 使用 cosmiconfig 发现 .module-agent.json，zod 校验后返回 WorkspaceConfig
// ---------------------------------------------------------------------------

import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG_ENTRY, DEFAULT_WORKSPACE_CONFIG, type ConfigEntry, type WorkspaceConfig } from './defaults.js';
import { WorkspaceConfigSchema } from './schema.js';
import { defaultLogger } from '../core/Logger.js';
import { configExplorer } from '../core/ConfigPaths.js';

export class ConfigLoader {
  static async load(projectRoot: string): Promise<WorkspaceConfig> {
    const { config } = await ConfigLoader.loadWithStatus(projectRoot);
    return config;
  }

  /**
   * 加载配置并暴露失败原因：校验失败/搜索失败时回落默认配置，
   * 但通过返回值 error 字段告知上游（可提示用户"配置无效，正使用默认值"）。
   */
  static async loadWithStatus(projectRoot: string): Promise<{ config: WorkspaceConfig; error?: string }> {
    try {
      const result = await configExplorer.search(projectRoot);
      if (!result || result.isEmpty) {
        defaultLogger.info(`[config] No config found from ${projectRoot}, using defaults`);
        return { config: { ...DEFAULT_WORKSPACE_CONFIG } };
      }

      defaultLogger.info(`[config] Loading config: ${result.filepath}`);
      const raw = result.config;

      const parsed = WorkspaceConfigSchema.safeParse(raw);
      if (parsed.success) {
        defaultLogger.info(`[config] Loaded ${parsed.data.configs.length} config(s), default: ${parsed.data.defaultConfig}`);
        const defaultEntry = ConfigLoader.getDefaultConfig(parsed.data);
        const resolvedConfigDir = path.resolve(path.dirname(result.filepath));
        const resolvedProjectPath = path.resolve(defaultEntry.projectPath);
        if (resolvedProjectPath !== resolvedConfigDir) {
          defaultLogger.warn('[config] projectPath in config differs from config file location');
        }
        return { config: parsed.data };
      }

      // zod 校验失败：记录可读的错误详情并随结果暴露
      const detail = parsed.error.issues
        .map(issue => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      defaultLogger.warn('[config] Invalid config format, using defaults');
      defaultLogger.error(`[config] Config validation failed for ${result.filepath}:\n${detail}`);
      return {
        config: { ...DEFAULT_WORKSPACE_CONFIG },
        error: `配置文件 ${result.filepath} 校验失败，正使用默认配置:\n${detail}`,
      };
    } catch (err) {
      defaultLogger.warn('[config] Failed to search config, using defaults');
      defaultLogger.error(`[config] Config search failed from ${projectRoot}: ${(err as Error).message}`);
      return {
        config: { ...DEFAULT_WORKSPACE_CONFIG },
        error: `配置搜索失败（${(err as Error).message}），正使用默认配置`,
      };
    }
  }

  static async loadOrCreate(projectRoot: string): Promise<WorkspaceConfig> {
    try {
      const result = await configExplorer.search(projectRoot);
      if (result && !result.isEmpty) {
        return ConfigLoader.load(projectRoot);
      }
    } catch { /* fall through to create */ }

    const configPath = path.join(projectRoot, '.module-agent.json');
    await fs.writeJson(configPath, DEFAULT_WORKSPACE_CONFIG, { spaces: 2 });
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }

  // 获取激活（默认）的配置条目
  static getDefaultConfig(workspace: WorkspaceConfig): ConfigEntry {
    const found = workspace.configs.find(c => c.name === workspace.defaultConfig);
    return found || workspace.configs[0] || DEFAULT_CONFIG_ENTRY;
  }

  /** 保存配置到项目根目录的 .module-agent.json。先验证再写入。 */
  static async save(projectRoot: string, config: WorkspaceConfig): Promise<void> {
    const parsed = WorkspaceConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(`Config validation failed: ${parsed.error.message}`);
    }
    const configPath = path.join(projectRoot, '.module-agent.json');
    await fs.writeJson(configPath, parsed.data, { spaces: 2 });
    defaultLogger.info(`[config] Saved config to ${configPath}`);
  }

  /** 更新配置中的单个条目，保留其他条目不变。若条目不存在则追加。 */
  static async upsertEntry(projectRoot: string, entry: ConfigEntry, setAsDefault?: boolean): Promise<void> {
    const existing = await ConfigLoader.load(projectRoot);
    const idx = existing.configs.findIndex(c => c.name === entry.name);
    if (idx >= 0) {
      existing.configs[idx] = entry;
    } else {
      existing.configs.push(entry);
    }
    if (setAsDefault !== false) {
      existing.defaultConfig = entry.name;
    }
    await ConfigLoader.save(projectRoot, existing);
  }
}
