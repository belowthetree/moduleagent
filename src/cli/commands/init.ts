import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGenerator } from '../../core/ModuleGenerator.js';

export function initCommand(program: Command) {
  program
    .command('init [projectPath]')
    .description('扫描项目目录，自动生成 module.md 和 .module-agent.json')
    .option('-f, --force', '覆盖已存在的 module.md')
    .action(async (projectPath?: string, options?: { force?: boolean }) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      console.log(`[init] 项目路径: ${root}`);

      const isProjectRoot = !projectPath || path.resolve(projectPath) === process.cwd();
      const rootModuleMd = path.join(root, 'module.md');
      const configFile = path.join(root, '.module-agent.json');

      if (await fs.pathExists(rootModuleMd) && !options?.force) {
        console.log('[init] module.md 已存在，使用 --force 覆盖');
      } else {
        const content = await ModuleGenerator.generate({
          dirPath: root,
          force: options?.force,
        });
        await fs.writeFile(rootModuleMd, content, 'utf-8');
        console.log(`[init] 已生成 module.md: ${path.relative(process.cwd(), rootModuleMd)}`);
      }

      if (isProjectRoot) {
        if (await fs.pathExists(configFile) && !options?.force) {
          console.log('[init] .module-agent.json 已存在，跳过');
        } else {
          const defaultConfig = {
            agents: {
              default: {
                command: 'claude',
                args: ['--acp', '--dangerously-skip-permissions'],
              },
            },
            exclude: [],
            workspace: {
              path: '~/.module-agent/workspaces',
            },
          };
          await fs.writeJson(configFile, defaultConfig, { spaces: 2 });
          console.log(`[init] 已生成 .module-agent.json: ${path.relative(process.cwd(), configFile)}`);
        }
      }

      const descriptors = await ModuleScanner.scan({ projectRoot: root });
      console.log(`[init] 发现 ${descriptors.length} 个模块:`);
      for (const d of descriptors) {
        console.log(`  - ${d.name} (${d.relativePath})`);
      }
    });
}
