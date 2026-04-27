import { Command } from 'commander';
import path from 'path';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import type { ModuleGraphNode } from '../../types/module.js';

export function treeCommand(program: Command) {
  program
    .command('tree [projectPath]')
    .description('以树形结构展示模块信息')
    .option('-d, --detail', '显示模块详细信息')
    .action(async (projectPath?: string, options?: { detail?: boolean }) => {
      const root = projectPath ? path.resolve(projectPath) : process.cwd();
      const descriptors = await ModuleScanner.scan({ projectRoot: root });

      if (descriptors.length === 0) {
        console.log('未发现任何模块');
        return;
      }

      const graph = new ModuleGraph().build(descriptors, root);
      const rootNode = graph.nodes.get(graph.root);
      if (!rootNode) {
        console.log('未找到根模块');
        return;
      }

      printNode(rootNode, graph, '', true, true, options?.detail ?? false);
    });
}

function printNode(
  node: ModuleGraphNode,
  graph: { nodes: Map<string, ModuleGraphNode> },
  indent: string,
  isRoot: boolean,
  isLast: boolean,
  detail: boolean,
) {
  const icon = isRoot ? '◆' : '├';
  const connector = isRoot ? '' : '─';

  const desc = detail
    ? ` — ${node.definition.frontmatter.description || '无描述'}`
    : '';
  const count = node.definition.subModules.length > 0
    ? ` [${node.definition.subModules.length} 子模块]`
    : '';

  if (isRoot) {
    console.log(`${icon} ${node.name} (${node.relativePath})${desc}${count}`);
  } else {
    const prefix = indent + (isLast ? '└' : '├') + connector;
    console.log(`${prefix} ${node.name} (${node.relativePath})${desc}${count}`);
  }

  if (detail && node.definition.frontmatter.source) {
    const src = node.definition.frontmatter.source;
    const childIndent = indent + (isRoot ? '' : (isLast ? '   ' : '│  '));
    if (src.type === 'git') {
      console.log(`${childIndent}  源: git:${src.url || 'unknown'}${src.branch ? `@${src.branch}` : ''}`);
    } else {
      console.log(`${childIndent}  源: local:${src.path || node.relativePath}`);
    }
  }

  const children = node.children;
  const childIndent = indent + (isRoot ? '  ' : (isLast ? '   ' : '│  '));

  for (let i = 0; i < children.length; i++) {
    const childName = children[i];
    const childNode = graph.nodes.get(childName!);
    if (!childNode) continue;
    printNode(childNode, graph, childIndent, false, i === children.length - 1, detail);
  }
}
