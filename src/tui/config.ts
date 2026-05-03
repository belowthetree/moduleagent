import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG, type ProjectConfig } from '../config/defaults.js';
import { ProjectConfigSchema } from '../config/schema.js';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export function resolveProjectRoot(cwd?: string): string {
  let dir = path.resolve(cwd ?? process.cwd());

  while (true) {
    if (
      existsSync(path.join(dir, '.module-agent.json')) ||
      existsSync(path.join(dir, 'module.md'))
    ) {
      console.log(`[config] 项目根目录: ${dir}`);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const fallback = path.resolve(cwd ?? process.cwd());
  console.log(`[config] 未找到项目标记文件，使用当前目录: ${fallback}`);
  return fallback;
}

export async function validateModuleAgentJson(projectRoot: string): Promise<boolean> {
  const configPath = path.join(projectRoot, '.module-agent.json');

  try {
    await fs.access(configPath);
    const config = await ConfigLoader.load(projectRoot);
    return !!config.agents.default.command;
  } catch {
    return false;
  }
}

export function getDefaultConfig(): ProjectConfig {
  return DEFAULT_CONFIG;
}

export async function writeModuleAgentJson(
  projectRoot: string,
  partialConfig: Partial<ProjectConfig>,
): Promise<void> {
  const existingConfig = await ConfigLoader.load(projectRoot);

  const merged: ProjectConfig = {
    ...existingConfig,
    ...partialConfig,
    agents: { ...existingConfig.agents, ...partialConfig.agents } as ProjectConfig['agents'],
    exclude: partialConfig.exclude ?? existingConfig.exclude,
    workspace: { ...existingConfig.workspace, ...partialConfig.workspace },
    codeSource: { ...existingConfig.codeSource, ...partialConfig.codeSource },
  };

  ProjectConfigSchema.parse(merged);

  const configPath = path.join(projectRoot, '.module-agent.json');
  console.log(`[config] 写入配置文件: ${configPath}`);
  console.log('[config] 写入配置:', JSON.stringify(merged, null, 2));
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}
