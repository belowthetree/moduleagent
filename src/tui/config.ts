import { ConfigLoader } from '../config/ConfigLoader.js';
import { DEFAULT_CONFIG_ENTRY, type WorkspaceConfig, type ConfigEntry } from '../config/defaults.js';
import { WorkspaceConfigSchema } from '../config/schema.js';
import { defaultLogger } from '../core/Logger.js';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const LAST_PROJECT_FILE = path.join(os.homedir(), '.module-agent', 'last-project');

// No upward search — just resolve to cwd or explicit project root
export function resolveProjectRoot(cwd?: string): string {
  return path.resolve(cwd ?? process.cwd());
}

export async function validateModuleAgentJson(projectRoot: string): Promise<boolean> {
  const configPath = path.join(projectRoot, '.module-agent.json');

  try {
    await fs.access(configPath);
    const config = await ConfigLoader.load(projectRoot);
    // Valid if at least one config entry has a command
    return config.configs.length > 0 && !!config.configs[0]?.agents.default.command;
  } catch {
    return false;
  }
}

export function getDefaultConfig(): ConfigEntry {
  return DEFAULT_CONFIG_ENTRY;
}

// Get the active config entry from the workspace
export function getDefaultEntry(workspace: WorkspaceConfig): ConfigEntry {
  return ConfigLoader.getDefaultConfig(workspace);
}

export async function writeModuleAgentJson(
  projectRoot: string,
  entryConfig: Partial<ConfigEntry> & { name?: string },
): Promise<void> {
  const existing = await ConfigLoader.load(projectRoot);

  const entryName = entryConfig.name || 'default';
  const existingIdx = existing.configs.findIndex(c => c.name === entryName);

  const newEntry: ConfigEntry = {
    name: entryName,
    agents: entryConfig.agents ?? DEFAULT_CONFIG_ENTRY.agents,
    exclude: entryConfig.exclude ?? DEFAULT_CONFIG_ENTRY.exclude,
    workspace: entryConfig.workspace ?? DEFAULT_CONFIG_ENTRY.workspace,
    codeSource: entryConfig.codeSource ?? DEFAULT_CONFIG_ENTRY.codeSource,
    modulesPath: entryConfig.modulesPath ?? '',
  };

  if (existingIdx >= 0) {
    existing.configs[existingIdx] = newEntry;
  } else {
    existing.configs.push(newEntry);
  }

  // Set defaultConfig to the new/updated entry
  existing.defaultConfig = entryName;

  WorkspaceConfigSchema.parse(existing);

  const configPath = path.join(projectRoot, '.module-agent.json');
  defaultLogger.info(`[config] Writing config: ${configPath}`);
  defaultLogger.info('[config] Config:', JSON.stringify(existing, null, 2));
  await fs.writeFile(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
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
