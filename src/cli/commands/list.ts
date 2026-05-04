import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { writeJson, nodeToListItem, type ModuleListItem } from '../utils/output.js';

export interface ListOptions {
  projectRoot: string;
}

export async function listModules(options: ListOptions): Promise<void> {
  const workspaceConfig = await ConfigLoader.load(options.projectRoot);
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  const descriptors = await ModuleScanner.scan({
    projectRoot: options.projectRoot,
    extraExclude: config.exclude,
  });
  const graph = new ModuleGraph().build(descriptors, options.projectRoot);

  const items: ModuleListItem[] = [];
  for (const [, node] of graph.nodes) {
    items.push(nodeToListItem(node));
  }

  writeJson({ root: graph.root, modules: items });
}
