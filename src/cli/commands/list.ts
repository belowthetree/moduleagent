// ---------------------------------------------------------------------------
// cli/commands/list.ts — 列出所有模块命令
// 扫描项目并输出所有模块的列表
// ---------------------------------------------------------------------------

import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { writeJson, nodeToListItem, type ModuleListItem } from '../utils/output.js';
import path from 'path';
import fs from 'fs-extra';

export interface ListOptions {
  projectRoot: string;
}

export async function listModules(options: ListOptions): Promise<void> {
  const workspaceConfig = await ConfigLoader.load(options.projectRoot);
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  const moduleScanPath = path.join(options.projectRoot, '.module-agent', 'module');
  fs.ensureDirSync(moduleScanPath);
  const descriptors = await ModuleScanner.scan({
    projectRoot: moduleScanPath,
    extraExclude: config.exclude,
  });
  const graph = new ModuleGraph().build(descriptors, options.projectRoot);

  const items: ModuleListItem[] = [];
  for (const [, node] of graph.nodes) {
    items.push(nodeToListItem(node));
  }

  writeJson({ root: graph.root, modules: items });
}
