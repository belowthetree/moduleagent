// ---------------------------------------------------------------------------
// core/ConfigPaths.ts — 配置路径管理
// 提供开发/生产模式检测、Prompt 配置目录解析、配置文件初始化（cosmiconfig 发现）
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import os from 'os';
import { cosmiconfig } from 'cosmiconfig';
import { defaultLogger } from './Logger.js';

// ---------------------------------------------------------------------------
// 开发模式检测
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
// 平台配置目录
// ---------------------------------------------------------------------------

/** @deprecated 使用 getProjectConfigDir(projectRoot) 代替 */
export function getUserConfigRoot(): string {
  return path.join(os.homedir(), '.module-agent');
}

export function getProjectConfigDir(projectRoot: string): string {
  return path.join(projectRoot, '.module-agent', 'config');
}

/**
 * dev 模式：从仓库的 config/ 读取
 * 生产模式：从项目的 .module-agent/config/ 读取
 */
export function getPromptConfigDir(basePath: string, projectRoot?: string): string {
  if (isDev()) {
    return path.join(basePath, 'config');
  }
  return getProjectConfigDir(projectRoot || basePath);
}

// ---------------------------------------------------------------------------
// 运行时配置文件初始化（复制到项目 .module-agent/config/）
// ---------------------------------------------------------------------------

export function ensureConfigFiles(bundledConfigDir: string, projectRoot: string): void {
  if (isDev()) return;

  const promptTargetDir = getProjectConfigDir(projectRoot);

  // 确保目标目录存在
  fs.mkdirSync(promptTargetDir, { recursive: true });

  // 从捆绑配置目录复制 .md 提示文件（包括 knowledge/ 子目录）
  try {
    const files = fs.readdirSync(bundledConfigDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const src = path.join(bundledConfigDir, file);
        const dest = path.join(promptTargetDir, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
          defaultLogger.info(`[config] Initialized: ${dest}`);
        }
      }
    }
    // 同时复制 knowledge/ 子目录
    const knowledgeSrc = path.join(bundledConfigDir, 'knowledge');
    const knowledgeDest = path.join(promptTargetDir, 'knowledge');
    if (fs.existsSync(knowledgeSrc)) {
      fs.mkdirSync(knowledgeDest, { recursive: true });
      const knowledgeFiles = fs.readdirSync(knowledgeSrc);
      for (const file of knowledgeFiles) {
        if (!file.endsWith('.md')) continue;
        const src = path.join(knowledgeSrc, file);
        const dest = path.join(knowledgeDest, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
          defaultLogger.info(`[config] Initialized: ${dest}`);
        }
      }
    }
  } catch (err) {
    defaultLogger.warn(`[config] Cannot read bundled config dir: ${bundledConfigDir}`);
  }

  // 从捆绑的应用根目录复制 .module-agent.json 模板
  const bundledJsonPath = path.join(path.dirname(bundledConfigDir), '.module-agent.json');
  const userJsonPath = path.join(projectRoot, '.module-agent.json');
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
// Cosmiconfig 探索器用于发现 .module-agent.json
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
