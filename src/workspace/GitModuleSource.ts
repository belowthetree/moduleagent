import fs from 'fs-extra';
import { simpleGit } from 'simple-git';
import type { SourceConfig } from '../types/module.js';

export class GitModuleSource {
  async sync(config: SourceConfig, targetDir: string): Promise<void> {
    const url = config.url;
    if (!url) throw new Error('Git source requires a URL');

    const gitDir = `${targetDir}`;

    if (await fs.pathExists(targetDir)) {
      const files = await fs.readdir(targetDir);
      if (files.length === 0) {
        await this.clone(url, config.branch, gitDir);
        return;
      }

      try {
        const git = simpleGit(gitDir);
        const isRepo = await git.checkIsRepo();
        if (isRepo) {
          await git.pull();
          return;
        }
      } catch {}

      await fs.emptyDir(gitDir);
      await this.clone(url, config.branch, gitDir);
    } else {
      await fs.ensureDir(targetDir);
      await this.clone(url, config.branch, gitDir);
    }
  }

  private async clone(url: string, branch: string | undefined, targetDir: string): Promise<void> {
    const git = simpleGit();
    const args: string[] = [];
    if (branch) args.push('-b', branch);
    args.push(url, targetDir);
    await git.clone(url, targetDir, branch ? ['-b', branch] : []);
  }
}
