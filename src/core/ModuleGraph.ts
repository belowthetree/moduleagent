import type { ModuleDescriptor, ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../types/module.js';
import { defaultLogger as log } from './Logger.js';

export class ModuleGraph {
  private nodes: Map<string, ModuleGraphNode> = new Map();
  private root: string | null = null;

  build(descriptors: ModuleDescriptor[], projectRoot: string): ModuleGraphType {
    this.nodes.clear();

    for (const desc of descriptors) {
      let nodeName = desc.name;
      if (this.nodes.has(nodeName)) {
        const fallback = desc.relativePath;
        if (this.nodes.has(fallback)) {
          log.warn(`ModuleGraph: skipping duplicate module "${desc.name}" at "${desc.relativePath}" — name collision, both name and relativePath already taken`);
          continue;
        }
        log.warn(`ModuleGraph: renaming "${desc.name}" → "${fallback}" (name collision, "${desc.name}" already in graph)`);
        (desc as { name: string }).name = fallback;
        nodeName = fallback;
      }
      const node: ModuleGraphNode = {
        name: nodeName,
        absolutePath: desc.rootPath,
        relativePath: desc.relativePath,
        parent: null,
        children: [],
        definition: desc.definition,
      };
      this.nodes.set(nodeName, node);
    }

    if (this.nodes.size === 0) {
      throw new Error('No modules found in the project');
    }

    const rootDesc = descriptors.find((d) => d.relativePath === '.');
    if (!rootDesc) {
      throw new Error('Root module (module.md at project root) is required');
    }
    this.root = rootDesc.name;

    for (const desc of descriptors) {
      const subModules = desc.definition.subModules;
      for (const sub of subModules) {
        const childNode = ModuleGraph.findModuleByName(descriptors, sub.name);
        if (childNode) {
          const parentNode = this.nodes.get(desc.name);
          const child = this.nodes.get(childNode.name);
          if (parentNode && child) {
            child.parent = desc.name;
            parentNode.children.push(child.name);
          }
        }
      }
    }

    log.info(`ModuleGraph: built with ${this.nodes.size} nodes, root=${this.root}`);
    for (const [name, node] of this.nodes) {
      log.info(`ModuleGraph: node "${name}" parent="${node.parent ?? '<none>'}" children=[${node.children.join(', ')}]`);
    }
    return {
      root: this.root,
      nodes: new Map(this.nodes),
    };
  }

  private static findModuleByName(
    descriptors: ModuleDescriptor[],
    name: string,
  ): ModuleDescriptor | undefined {
    const match = descriptors.find((d) => d.name === name);
    if (match) return match;
    return descriptors.find((d) => d.relativePath === name);
  }

  static getSubtreeNames(graph: ModuleGraphType, startName: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    ModuleGraph.collectSubtree(graph, startName, visited);
    for (const name of visited) {
      if (name !== startName) {
        result.push(name);
      }
    }
    return result;
  }

  private static collectSubtree(
    graph: ModuleGraphType,
    name: string,
    visited: Set<string>,
  ): void {
    if (visited.has(name)) return;
    visited.add(name);
    const node = graph.nodes.get(name);
    if (!node) return;
    for (const child of node.children) {
      ModuleGraph.collectSubtree(graph, child, visited);
    }
  }
}
