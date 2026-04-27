import path from 'path';
import os from 'os';
import fs from 'fs-extra';

export class WorkspaceManager {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static getBasePath(): string {
    const home = process.env.MODULE_AGENT_HOME || path.join(os.homedir(), '.module-agent');
    return path.join(home, 'workspaces');
  }

  getPath(): string {
    return this.basePath;
  }

  getMainPath(): string {
    return path.join(this.basePath, 'main');
  }

  getModulesPath(): string {
    return path.join(this.basePath, 'modules');
  }

  getModulePath(moduleName: string): string {
    return path.join(this.getModulesPath(), moduleName);
  }

  async setupMain(projectRoot: string): Promise<string> {
    const mainPath = this.getMainPath();
    await fs.ensureDir(mainPath);
    await this.copyModuleFiles(projectRoot, mainPath);
    return mainPath;
  }

  async setupModuleDir(moduleName: string): Promise<string> {
    const modulePath = this.getModulePath(moduleName);
    await fs.ensureDir(modulePath);
    return modulePath;
  }

  async copyModuleFiles(sourceDir: string, targetDir: string): Promise<void> {
    const excluded = new Set([
      'node_modules', '.git', 'dist', 'build', '__pycache__',
      '.next', 'coverage', '.turbo',
    ]);

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.module-agent.json' && entry.name !== 'module.md') continue;

      const srcPath = path.join(sourceDir, entry.name);
      const dstPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await fs.ensureDir(dstPath);
        await this.copyModuleFiles(srcPath, dstPath);
      } else {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }
}
