import path from 'path';
import fs from 'fs';
import os from 'os';
import { cosmiconfig } from 'cosmiconfig';
import { defaultLogger } from './Logger.js';

// ---------------------------------------------------------------------------
// Dev mode detection
// ---------------------------------------------------------------------------

export function isDev(): boolean {
  if (process.env.MODULE_AGENT_DEV === '1' || process.env.MODULE_AGENT_DEV === 'true') {
    return true;
  }
  if (process.argv.includes('--dev')) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Platform config directory
// ---------------------------------------------------------------------------

export function getUserConfigRoot(): string {
  return path.join(os.homedir(), '.module-agent');
}

export function getPromptConfigDir(basePath: string): string {
  if (isDev()) {
    return path.join(basePath, 'config');
  }
  return path.join(getUserConfigRoot(), 'config');
}

// ---------------------------------------------------------------------------
// Runtime config file initialization
// ---------------------------------------------------------------------------

export function ensureConfigFiles(bundledConfigDir: string): void {
  if (isDev()) return;

  const promptTargetDir = path.join(getUserConfigRoot(), 'config');
  const configRoot = getUserConfigRoot();

  // Ensure target directories exist
  fs.mkdirSync(promptTargetDir, { recursive: true });
  fs.mkdirSync(configRoot, { recursive: true });

  // Copy .md prompt files from bundled config/
  try {
    const files = fs.readdirSync(bundledConfigDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const src = path.join(bundledConfigDir, file);
      const dest = path.join(promptTargetDir, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        defaultLogger.info(`[config] Initialized: ${dest}`);
      }
    }
  } catch (err) {
    defaultLogger.warn(`[config] Cannot read bundled config dir: ${bundledConfigDir}`);
  }

  // Copy .module-agent.json template from bundled app root
  const bundledJsonPath = path.join(path.dirname(bundledConfigDir), '.module-agent.json');
  const userJsonPath = path.join(configRoot, '.module-agent.json');
  if (fs.existsSync(bundledJsonPath) && !fs.existsSync(userJsonPath)) {
    try {
      fs.copyFileSync(bundledJsonPath, userJsonPath);
      defaultLogger.info(`[config] Initialized: ${userJsonPath}`);
    } catch (err) {
      defaultLogger.warn(`[config] Cannot copy .module-agent.json: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cosmiconfig explorer for .module-agent.json discovery
// ---------------------------------------------------------------------------

export const configExplorer = cosmiconfig('module-agent', {
  searchPlaces: [
    '.module-agent.json',
    '.module-agentrc',
    '.module-agentrc.json',
    '.module-agentrc.yaml',
    '.module-agentrc.yml',
    'module-agent.config.js',
    'module-agent.config.cjs',
  ],
});
