import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';
import { defaultLogger } from '../core/Logger.js';

/**
 * Prepare the workspace directory for a role agent.
 * Copies all visible module source directories into the role workspace.
 *
 * @returns Path to the prepared workspace directory
 */
export async function prepareRoleWorkspace(options: {
  roleName: string;
  visibleModulePaths: string[];
  projectPath: string;
  workspaceRoot: string;
  onLog?: (msg: string) => void;
}): Promise<string> {
  const { roleName, visibleModulePaths, projectPath, workspaceRoot } = options;

  const roleDir = path.join(workspaceRoot, 'workrole', roleName);
  await fse.ensureDir(roleDir);

  for (const modulePath of visibleModulePaths) {
    const srcDir = path.join(projectPath, modulePath);
    const destDir = path.join(roleDir, modulePath);

    if (!fs.existsSync(srcDir)) {
      defaultLogger.warn(`Role ${roleName}: visible module path not found: ${srcDir}, skipping`);
      continue;
    }

    if (path.resolve(srcDir) === path.resolve(destDir)) continue;

    try {
      defaultLogger.info(`Role ${roleName}: copying ${srcDir} -> ${destDir}`);
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
      defaultLogger.error(`Role ${roleName}: failed to copy ${modulePath}: ${(err as Error).message}`);
    }
  }

  defaultLogger.info(`Role ${roleName}: workspace prepared at ${roleDir}`);
  return roleDir;
}

/**
 * Remove a role agent's workspace directory.
 */
export async function cleanupRoleWorkspace(
  roleName: string,
  workspaceRoot: string,
): Promise<void> {
  const roleDir = path.join(workspaceRoot, 'workrole', roleName);
  if (fs.existsSync(roleDir)) {
    try {
      await fse.remove(roleDir);
      defaultLogger.info(`Role ${roleName}: workspace removed: ${roleDir}`);
    } catch (err) {
      defaultLogger.error(`Role ${roleName}: failed to remove workspace: ${(err as Error).message}`);
    }
  }
}
