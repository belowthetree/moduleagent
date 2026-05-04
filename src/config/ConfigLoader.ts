import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG_ENTRY, DEFAULT_WORKSPACE_CONFIG, type ConfigEntry, type WorkspaceConfig } from './defaults.js';
import { ProjectConfigSchema, WorkspaceConfigSchema } from './schema.js';
import { defaultLogger } from '../core/Logger.js';

function migrateLegacyConfig(raw: Record<string, unknown>): WorkspaceConfig {
  // Parse as old single config, wrap into new array format
  const legacy = ProjectConfigSchema.parse(raw);
  return {
    configs: [{ name: 'default', ...legacy } as ConfigEntry],
    defaultConfig: 'default',
  };
}

export class ConfigLoader {
  static async load(projectRoot: string): Promise<WorkspaceConfig> {
    const configPath = path.join(projectRoot, '.module-agent.json');

    if (!await fs.pathExists(configPath)) {
      defaultLogger.info(`[config] No config file at ${configPath}, using defaults`);
      return { ...DEFAULT_WORKSPACE_CONFIG };
    }

    defaultLogger.info(`[config] Loading config: ${configPath}`);
    const raw = await fs.readJson(configPath);

    // Try new format first
    let result = WorkspaceConfigSchema.safeParse(raw);
    if (result.success) {
      defaultLogger.info(`[config] Loaded ${result.data.configs.length} config(s), default: ${result.data.defaultConfig}`);
      return result.data;
    }

    // Fall back: try old single-config format and migrate
    const legacyResult = ProjectConfigSchema.safeParse(raw);
    if (legacyResult.success) {
      defaultLogger.info('[config] Migrating legacy config to new array format');
      const migrated = {
        configs: [{ name: 'default', ...legacyResult.data } as ConfigEntry],
        defaultConfig: 'default',
      };
      // Save the migrated format back
      await fs.writeJson(configPath, migrated, { spaces: 2 });
      return migrated;
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
