import { Command } from 'commander';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { WorkspaceManager } from '../../workspace/WorkspaceManager.js';
import { ModuleSyncer } from '../../workspace/ModuleSyncer.js';

export function workspaceCommand(program: Command) {
  const ws = program
    .command('workspace')
    .description('管理持久化工作目录');

  ws
    .command('setup [projectPath]')
    .description('初始化工作目录并拉取所有模块代码')
    .action(async (projectPath?: string) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      const projectHash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
      const basePath = path.join(WorkspaceManager.getBasePath(), projectHash);

      console.log(`[workspace] 项目根: ${root}`);
      console.log(`[workspace] 工作区: ${basePath}`);

      await fs.ensureDir(basePath);

      const descriptors = await ModuleScanner.scan({ projectRoot: root });
      const graph = new ModuleGraph().build(descriptors, root);

      const manager = new WorkspaceManager(basePath);
      await manager.setupMain(root);

      const syncer = new ModuleSyncer(manager);

      for (const [name, node] of graph.nodes) {
        if (name === graph.root) continue;
        console.log(`[workspace] 同步模块: ${name}`);
        await syncer.syncModule(node);
      }

      console.log('[workspace] 工作区初始化完成');
    });

  ws
    .command('clean [projectPath]')
    .description('清理工作目录')
    .action(async (projectPath?: string) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      const projectHash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
      const basePath = path.join(WorkspaceManager.getBasePath(), projectHash);

      if (await fs.pathExists(basePath)) {
        await fs.remove(basePath);
        console.log(`[workspace] 已清理: ${basePath}`);
      } else {
        console.log('[workspace] 工作区不存在，无需清理');
      }
    });

  ws
    .command('status [projectPath]')
    .description('查看工作目录状态')
    .action(async (projectPath?: string) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      const projectHash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
      const basePath = path.join(WorkspaceManager.getBasePath(), projectHash);

      console.log(`[workspace] 工作区: ${basePath}`);
      console.log(`[workspace] 状态: ${await fs.pathExists(basePath) ? '已创建' : '未创建'}`);

      if (await fs.pathExists(basePath)) {
        const entries = await fs.readdir(basePath);
        console.log(`[workspace] 内容: ${entries.join(', ') || '(空)'}`);
      }
    });
}
