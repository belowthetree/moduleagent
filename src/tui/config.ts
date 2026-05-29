import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG_ENTRY, type ConfigEntry, type WorkspaceConfig } from '../config/defaults.js';
import { defaultLogger } from '../core/Logger.js';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const LAST_PROJECT_FILE = path.join(os.homedir(), '.module-agent', 'last-project');

// 不向上搜索——直接解析到 cwd 或显式项目根目录
export function resolveProjectRoot(cwd?: string): string {
  return path.resolve(cwd ?? process.cwd());
}

export async function validateModuleAgentJson(projectRoot: string): Promise<boolean> {
  const configPath = path.join(projectRoot, '.module-agent.json');

  try {
    await fs.access(configPath);
    const config = await ConfigLoader.load(projectRoot);
    // 至少有一个配置条目包含命令才视为有效
    return config.configs.length > 0 && !!config.configs[0]?.agents.default.command;
  } catch {
    return false;
  }
}

export function getDefaultConfig(): ConfigEntry {
  return DEFAULT_CONFIG_ENTRY;
}

// 从工作区获取活动的配置条目
export function getDefaultEntry(workspace: WorkspaceConfig): ConfigEntry {
  return ConfigLoader.getDefaultConfig(workspace);
}

export async function writeModuleAgentJson(
  projectRoot: string,
  entryConfig: Partial<ConfigEntry> & { name?: string },
): Promise<void> {
  const entryName = entryConfig.name || 'default';
  const newEntry: ConfigEntry = {
    name: entryName,
    agents: entryConfig.agents ?? DEFAULT_CONFIG_ENTRY.agents,
    exclude: entryConfig.exclude ?? DEFAULT_CONFIG_ENTRY.exclude,
    projectPath: entryConfig.projectPath ?? DEFAULT_CONFIG_ENTRY.projectPath,
  };
  await ConfigLoader.upsertEntry(projectRoot, newEntry, true);
}

export async function saveLastProjectRoot(projectRoot: string): Promise<void> {
  await fs.mkdir(path.dirname(LAST_PROJECT_FILE), { recursive: true });
  await fs.writeFile(LAST_PROJECT_FILE, projectRoot, 'utf-8');
  defaultLogger.info(`[config] Saved last project root: ${projectRoot}`);
}

export async function getLastProjectRoot(): Promise<string> {
  try {
    const content = await fs.readFile(LAST_PROJECT_FILE, 'utf-8');
    const trimmed = content.trim();
    if (trimmed && existsSync(trimmed)) {
      defaultLogger.info(`[config] Using last project root: ${trimmed}`);
      return trimmed;
    }
  } catch {}
  return '';
}
