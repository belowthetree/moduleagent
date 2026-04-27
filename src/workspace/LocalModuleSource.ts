import fs from 'fs-extra';
import path from 'path';

export class LocalModuleSource {
  async sync(srcPath: string, targetDir: string): Promise<void> {
    if (!await fs.pathExists(srcPath)) {
      throw new Error(`Source path does not exist: ${srcPath}`);
    }

    const excluded = new Set([
      'node_modules', '.git', 'dist', 'build', '__pycache__',
      '.next', 'coverage', '.turbo',
    ]);

    await fs.ensureDir(targetDir);

    await this.copyRecursive(srcPath, targetDir, excluded);
  }

  private async copyRecursive(src: string, dst: string, excluded: Set<string>): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      if (entry.isDirectory()) {
        await fs.ensureDir(dstPath);
        await this.copyRecursive(srcPath, dstPath, excluded);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }
}
