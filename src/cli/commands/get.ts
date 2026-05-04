import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { writeJson, writeError, nodeToDetail } from '../utils/output.js';

export interface GetOptions {
  projectRoot: string;
  moduleName: string;
}

export async function getModule(options: GetOptions): Promise<void> {
  const workspaceConfig = await ConfigLoader.load(options.projectRoot);
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  const descriptors = await ModuleScanner.scan({
    projectRoot: options.projectRoot,
    extraExclude: config.exclude,
  });
  const graph = new ModuleGraph().build(descriptors, options.projectRoot);

  const node = graph.nodes.get(options.moduleName);
  if (!node) {
    writeError(1, `Module not found: ${options.moduleName}`);
  }

  writeJson(nodeToDetail(node));
}
