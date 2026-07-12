// ---------------------------------------------------------------------------
// WorkflowWorkspace.ts — 工作流步骤工作空间管理
// 提供工作空间的准备（复制可见模块）、输出收集和清理功能
// ---------------------------------------------------------------------------

import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import { defaultLogger } from '../../core/Logger.js';

/**
 * Prepare an isolated workspace for a workflow step agent.
 * Copies visible module source directories into the step workspace.
 */
export async function prepareStepWorkspace(options: {
  workflowName: string;
  stepName: string;
  visibleModulePaths: string[];
  projectPath: string;
  workspaceRoot: string;
}): Promise<string> {
  const { workflowName, stepName, visibleModulePaths, projectPath, workspaceRoot } = options;

  const stepDir = path.join(workspaceRoot, 'workflow', workflowName, stepName);
  await fse.ensureDir(stepDir);

  for (const modulePath of visibleModulePaths) {
    const srcDir = path.join(projectPath, modulePath);
    const destDir = path.join(stepDir, modulePath);

    if (!fs.existsSync(srcDir)) {
      defaultLogger.warn(`Workflow ${workflowName}/${stepName}: visible module path not found: ${srcDir}, skipping`);
      continue;
    }

    if (path.resolve(srcDir) === path.resolve(destDir)) continue;

    try {
      defaultLogger.info(`Workflow ${workflowName}/${stepName}: copying ${srcDir} -> ${destDir}`);
      await fse.ensureDir(path.dirname(destDir));
      await fse.copy(srcDir, destDir, {
        overwrite: true,
        errorOnExist: false,
        filter: (src: string) => {
          const basename = path.basename(src);
          if (basename === 'node_modules' || basename === '.git') return false;
          return true;
        },
      });
    } catch (err) {
      defaultLogger.error(`Workflow ${workflowName}/${stepName}: failed to copy ${modulePath}: ${(err as Error).message}`);
    }
  }

  defaultLogger.info(`Workflow ${workflowName}/${stepName}: workspace prepared at ${stepDir}`);
  return stepDir;
}

/**
 * Copy step workspace contents to the persistent output directory.
 */
export async function collectStepOutput(options: {
  workspacePath: string;
  outputPath: string;
  workflowName: string;
  stepName: string;
  workspaceRoot: string;
}): Promise<string> {
  const { workspacePath, outputPath, workflowName, stepName, workspaceRoot } = options;

  const outputDir = path.join(workspaceRoot, 'workflow-output', workflowName, outputPath);
  await fse.ensureDir(outputDir);

  // Copy workspace contents (excluding visible module copies) to output
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(workspacePath, entry.name);
    const dest = path.join(outputDir, entry.name);

    // Skip node_modules and .git that might have been created by the agent
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    try {
      await fse.copy(src, dest, {
        overwrite: true,
        errorOnExist: false,
        filter: (_src: string) => {
          const basename = path.basename(_src);
          if (basename === 'node_modules' || basename === '.git') return false;
          return true;
        },
      });
    } catch (err) {
      defaultLogger.warn(`Workflow ${workflowName}/${stepName}: failed to copy output entry ${entry.name}: ${(err as Error).message}`);
    }
  }

  defaultLogger.info(`Workflow ${workflowName}/${stepName}: output collected to ${outputDir}`);
  return outputDir;
}

/**
 * Remove a workflow step's temporary workspace directory.
 */
export async function cleanupStepWorkspace(options: {
  workflowName: string;
  stepName: string;
  workspaceRoot: string;
}): Promise<void> {
  const { workspaceRoot, workflowName, stepName } = options;
  const stepDir = path.join(workspaceRoot, 'workflow', workflowName, stepName);
  if (fs.existsSync(stepDir)) {
    try {
      await fse.remove(stepDir);
      defaultLogger.info(`Workflow ${workflowName}/${stepName}: workspace removed: ${stepDir}`);
    } catch (err) {
      defaultLogger.error(`Workflow ${workflowName}/${stepName}: failed to remove workspace: ${(err as Error).message}`);
    }
  }
}
