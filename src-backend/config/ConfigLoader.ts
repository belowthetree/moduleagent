import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG_ENTRY, DEFAULT_WORKSPACE_CONFIG, type ConfigEntry, type WorkspaceConfig } from './defaults.js';
import { WorkspaceConfigSchema } from './schema.js';
import { defaultLogger } from '../core/Logger.js';
import { configExplorer } from '../core/ConfigPaths.js';

export class ConfigLoader {
  static async load(projectRoot: string): Promise<WorkspaceConfig> {
    try {
      const result = await configExplorer.search(projectRoot);
      if (!result || result.isEmpty) {
        defaultLogger.info(`[config] No config found from ${projectRoot}, using defaults`);
        return { ...DEFAULT_WORKSPACE_CONFIG };
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
        return parsed.data;
      }

      defaultLogger.warn('[config] Invalid config format, using defaults');
      return { ...DEFAULT_WORKSPACE_CONFIG };
    } catch {
      defaultLogger.warn('[config] Failed to search config, using defaults');
      return { ...DEFAULT_WORKSPACE_CONFIG };
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
}
