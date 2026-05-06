import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG_ENTRY, DEFAULT_WORKSPACE_CONFIG, type ConfigEntry, type WorkspaceConfig } from './defaults.js';
import { WorkspaceConfigSchema } from './schema.js';
import { defaultLogger } from '../core/Logger.js';

export class ConfigLoader {
  static async load(projectRoot: string): Promise<WorkspaceConfig> {
    const configPath = path.join(projectRoot, '.module-agent.json');

    if (!await fs.pathExists(configPath)) {
      defaultLogger.info(`[config] No config file at ${configPath}, using defaults`);
      return { ...DEFAULT_WORKSPACE_CONFIG };
    }

    defaultLogger.info(`[config] Loading config: ${configPath}`);
    let raw: unknown;
    try {
      raw = await fs.readJson(configPath);
    } catch {
      defaultLogger.warn('[config] Failed to read config file, using defaults');
      return { ...DEFAULT_WORKSPACE_CONFIG };
    }

    const result = WorkspaceConfigSchema.safeParse(raw);
    if (result.success) {
      defaultLogger.info(`[config] Loaded ${result.data.configs.length} config(s), default: ${result.data.defaultConfig}`);
      // Warn if projectPath in config differs from config file location
      const defaultEntry = ConfigLoader.getDefaultConfig(result.data);
      const resolvedConfigDir = path.resolve(projectRoot);
      const resolvedProjectPath = path.resolve(defaultEntry.projectPath);
      if (resolvedProjectPath !== resolvedConfigDir) {
        defaultLogger.warn('[config] projectPath in config differs from config file location');
      }
      return result.data;
    }

    defaultLogger.warn('[config] Invalid config format, using defaults');
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }

  static async loadOrCreate(projectRoot: string): Promise<WorkspaceConfig> {
    const configPath = path.join(projectRoot, '.module-agent.json');

    if (await fs.pathExists(configPath)) {
      return ConfigLoader.load(projectRoot);
    }

    await fs.writeJson(configPath, DEFAULT_WORKSPACE_CONFIG, { spaces: 2 });
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }

  // Get the active (default) config entry
  static getDefaultConfig(workspace: WorkspaceConfig): ConfigEntry {
    const found = workspace.configs.find(c => c.name === workspace.defaultConfig);
    return found || workspace.configs[0] || DEFAULT_CONFIG_ENTRY;
  }
}
