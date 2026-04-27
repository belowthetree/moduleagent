import fs from 'fs-extra';
import path from 'path';
import { DEFAULT_CONFIG, type ProjectConfig } from './defaults.js';
import { ProjectConfigSchema } from './schema.js';

export class ConfigLoader {
  static async load(projectRoot: string): Promise<ProjectConfig> {
    const configPath = path.join(projectRoot, '.module-agent.json');

    if (!await fs.pathExists(configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    const raw = await fs.readJson(configPath);
    const result = ProjectConfigSchema.safeParse(raw);

    if (!result.success) {
      console.warn('[config] .module-agent.json 格式不正确，使用默认配置');
      console.warn(result.error.format());
      return { ...DEFAULT_CONFIG };
    }

    return result.data;
  }

  static async loadOrCreate(projectRoot: string): Promise<ProjectConfig> {
    const configPath = path.join(projectRoot, '.module-agent.json');

    if (await fs.pathExists(configPath)) {
      return ConfigLoader.load(projectRoot);
    }

    await fs.writeJson(configPath, DEFAULT_CONFIG, { spaces: 2 });
    return { ...DEFAULT_CONFIG };
  }
}
