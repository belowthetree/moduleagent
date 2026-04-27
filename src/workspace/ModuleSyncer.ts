import type { ModuleGraphNode } from '../types/module.js';
import { WorkspaceManager } from './WorkspaceManager.js';
import { GitModuleSource } from './GitModuleSource.js';
import { LocalModuleSource } from './LocalModuleSource.js';

export class ModuleSyncer {
  private manager: WorkspaceManager;

  constructor(manager: WorkspaceManager) {
    this.manager = manager;
  }

  async syncModule(node: ModuleGraphNode): Promise<string> {
    const source = node.definition.frontmatter.source;
    const modulePath = await this.manager.setupModuleDir(node.name);

    if (source) {
      try {
        if (source.type === 'git') {
          const gitSrc = new GitModuleSource();
          await gitSrc.sync(source, modulePath);
          return modulePath;
        } else if (source.type === 'local') {
          const localSrc = new LocalModuleSource();
          const srcPath = source.path || node.absolutePath;
          await localSrc.sync(srcPath, modulePath);
          return modulePath;
        }
      } catch (err) {
        console.error(`[workspace] 拉取模块 ${node.name} 失败 (${source.type}):`, (err as Error).message);
        console.log(`[workspace] 回退到本地复制: ${node.absolutePath} -> ${modulePath}`);
      }
    }

    await this.manager.copyModuleFiles(node.absolutePath, modulePath);
    return modulePath;
  }
}
