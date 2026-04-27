import { Command } from 'commander';
import path from 'path';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';

export function scanCommand(program: Command) {
  program
    .command('scan [projectPath]')
    .description('扫描项目模块结构，校验 module.md 完整性和一致性')
    .option('-s, --strict', '严格模式：子模块声明必须有对应 module.md')
    .action(async (projectPath?: string, options?: { strict?: boolean }) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      console.log(`[scan] 扫描路径: ${root}`);

      const descriptors = await ModuleScanner.scan({ projectRoot: root });
      console.log(`[scan] 发现 ${descriptors.length} 个模块`);

      const graph = new ModuleGraph().build(descriptors, root);
      console.log(`[scan] 根模块: ${graph.root}`);

      const errors: string[] = [];
      const warnings: string[] = [];

      for (const [name, node] of graph.nodes) {
        console.log(`[scan]   ${name === graph.root ? '◆' : '├'} ${name} (${node.relativePath})`);

        const declaredChildren = node.definition.subModules.map((s) => s.name);
        for (const childName of node.children) {
          console.log(`[scan]   │  └ ${childName}`);
        }

        for (const sub of node.definition.subModules) {
          if (!graph.nodes.has(sub.name)) {
            const msg = `模块 "${name}" 声明的子模块 "${sub.name}" 在项目中未找到对应的 module.md`;
            if (options?.strict) {
              errors.push(msg);
            } else {
              warnings.push(msg);
            }
          }
        }
      }

      if (warnings.length > 0) {
        console.log('\n[scan] 警告:');
        for (const w of warnings) console.log(`  ⚠ ${w}`);
      }

      if (errors.length > 0) {
        console.log('\n[scan] 错误:');
        for (const e of errors) console.log(`  ✗ ${e}`);
        process.exit(1);
      } else {
        console.log(`\n[scan] 扫描完成，${descriptors.length} 个模块，结构正常`);
      }
    });
}
