import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import { writeJson, writeError, nodeToDetail } from '../utils/output.js';
import path from 'path';
import fs from 'fs-extra';

export interface GetOptions {
  projectRoot: string;
  moduleName: string;
}

export async function getModule(options: GetOptions): Promise<void> {
  const workspaceConfig = await ConfigLoader.load(options.projectRoot);
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  const moduleScanPath = path.join(options.projectRoot, '.module-agent', 'module');
  fs.ensureDirSync(moduleScanPath);
  const descriptors = await ModuleScanner.scan({
    projectRoot: moduleScanPath,
    extraExclude: config.exclude,
  });
  const graph = new ModuleGraph().build(descriptors, options.projectRoot);

  const node = graph.nodes.get(options.moduleName);
  if (!node) {
    writeError(1, `Module not found: ${options.moduleName}`);
  }

  writeJson(nodeToDetail(node));
}
