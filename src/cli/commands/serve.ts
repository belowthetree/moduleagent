import readline from 'readline';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import { nodeToListItem, nodeToDetail } from '../utils/output.js';
import { defaultLogger as log } from '../../core/Logger.js';

export interface ServeOptions {
  projectRoot: string;
}

interface NdjsonRequest {
  id: string;
  type: 'list' | 'get' | 'rescan' | 'exit';
  name?: string;
}

export async function serve(options: ServeOptions): Promise<void> {
  log.info(`Serve: starting for ${options.projectRoot}`);
  process.stderr.write('[cli:serve] Scanning project...\n');

  let state = await scanProject(options.projectRoot);

  process.stderr.write(`[cli:serve] Scanned ${state.graph.nodes.size} modules. Ready.\n`);
  log.info(`Serve: ready, ${state.graph.nodes.size} modules`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: NdjsonRequest;
    try {
      req = JSON.parse(trimmed) as NdjsonRequest;
    } catch {
      process.stderr.write(`[cli:serve] Invalid JSON: ${trimmed}\n`);
      log.warn(`Serve: invalid JSON input`);
      continue;
    }

    if (!req.id || !req.type) {
      process.stderr.write(`[cli:serve] Missing id or type\n`);
      log.warn(`Serve: missing id or type in request`);
      continue;
    }

    log.info(`Serve: request id=${req.id} type=${req.type}${req.name ? ` name=${req.name}` : ''}`);

    try {
      switch (req.type) {
        case 'list':
          respond(req.id, serializeList(state.graph));
          break;

        case 'get': {
          const node = state.graph.nodes.get(req.name ?? '');
          if (!node) {
            respond(req.id, null, `Module not found: ${req.name}`);
            log.warn(`Serve: module not found: ${req.name}`);
          } else {
            respond(req.id, nodeToDetail(node));
          }
          break;
        }

        case 'rescan':
          process.stderr.write('[cli:serve] Rescanning...\n');
          log.info('Serve: rescanning');
          state = await scanProject(options.projectRoot);
          process.stderr.write(`[cli:serve] Rescanned ${state.graph.nodes.size} modules.\n`);
          respond(req.id, serializeList(state.graph));
          break;

        case 'exit':
          respond(req.id, null);
          log.info('Serve: exit requested');
          process.exit(0);
          break;

        default:
          process.stderr.write(`[cli:serve] Unknown type: ${req.type}\n`);
          log.warn(`Serve: unknown request type: ${req.type}`);
      }
    } catch (err) {
      log.error(`Serve: request error | ${(err as Error).message}`);
      respond(req.id, null, (err as Error).message);
    }
  }
}

function respond(id: string, data: unknown, error?: string): void {
  const obj: Record<string, unknown> = { id };
  if (error) {
    obj.success = false;
    obj.error = error;
  } else {
    obj.success = true;
    obj.data = data;
  }
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function serializeList(graph: ModuleGraphType) {
  const modules: unknown[] = [];
  for (const [, node] of graph.nodes) {
    modules.push(nodeToListItem(node));
  }
  return { root: graph.root, modules };
}

async function scanProject(projectRoot: string) {
  const workspaceConfig = await ConfigLoader.load(projectRoot);
  const config = ConfigLoader.getDefaultConfig(workspaceConfig);
  const descriptors = await ModuleScanner.scan({ projectRoot, extraExclude: config.exclude });
  const graph = new ModuleGraph().build(descriptors, projectRoot);
  return { graph, descriptors };
}
