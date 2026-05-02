import type { ModuleDescriptor, ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../types/module.js';
import { defaultLogger as log } from './Logger.js';

export class ModuleGraph {
  private nodes: Map<string, ModuleGraphNode> = new Map();
  private root: string | null = null;

  build(descriptors: ModuleDescriptor[], projectRoot: string): ModuleGraphType {
    this.nodes.clear();

    for (const desc of descriptors) {
      const node: ModuleGraphNode = {
        name: desc.name,
        absolutePath: desc.rootPath,
        relativePath: desc.relativePath,
        parent: null,
        children: [],
        definition: desc.definition,
      };
      this.nodes.set(desc.name, node);
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
    return {
      root: this.root,
      nodes: new Map(this.nodes),
    };
  }

  private static findModuleByName(
    descriptors: ModuleDescriptor[],
    name: string,
  ): ModuleDescriptor | undefined {
    return descriptors.find((d) => d.name === name);
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
