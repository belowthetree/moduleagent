import readline from 'readline';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { ConfigLoader } from '../../config/ConfigLoader.js';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import { nodeToListItem, nodeToDetail } from '../utils/output.js';

export interface ServeOptions {
  projectRoot: string;
}

interface NdjsonRequest {
  id: string;
  type: 'list' | 'get' | 'rescan' | 'exit';
  name?: string;
}

export async function serve(options: ServeOptions): Promise<void> {
  process.stderr.write('[cli:serve] Scanning project...\n');

  let state = await scanProject(options.projectRoot);

  process.stderr.write(`[cli:serve] Scanned ${state.graph.nodes.size} modules. Ready.\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let req: NdjsonRequest;
    try {
      req = JSON.parse(trimmed) as NdjsonRequest;
    } catch {
      process.stderr.write(`[cli:serve] Invalid JSON: ${trimmed}\n`);
      continue;
    }

    if (!req.id || !req.type) {
      process.stderr.write(`[cli:serve] Missing id or type\n`);
      continue;
    }

    try {
      switch (req.type) {
        case 'list':
          respond(req.id, serializeList(state.graph));
          break;

        case 'get': {
          const node = state.graph.nodes.get(req.name ?? '');
          if (!node) {
            respond(req.id, null, `Module not found: ${req.name}`);
          } else {
            respond(req.id, nodeToDetail(node));
          }
          break;
        }

        case 'rescan':
          process.stderr.write('[cli:serve] Rescanning...\n');
          state = await scanProject(options.projectRoot);
          process.stderr.write(`[cli:serve] Rescanned ${state.graph.nodes.size} modules.\n`);
          respond(req.id, serializeList(state.graph));
          break;

        case 'exit':
          respond(req.id, null);
          process.exit(0);
          break;

        default:
          process.stderr.write(`[cli:serve] Unknown type: ${req.type}\n`);
      }
    } catch (err) {
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
  const config = await ConfigLoader.load(projectRoot);
  const descriptors = await ModuleScanner.scan({ projectRoot, extraExclude: config.exclude });
  const graph = new ModuleGraph().build(descriptors, projectRoot);
  return { graph, descriptors };
}
