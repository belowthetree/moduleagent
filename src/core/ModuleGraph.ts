// ---------------------------------------------------------------------------
// core/ModuleGraph.ts — 模块依赖图构建器
// 基于扫描结果构建模块依赖树，提供按名称查找和子树收集功能
// ---------------------------------------------------------------------------

import type { ModuleDescriptor, ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../types/module.js';
import { defaultLogger as log } from './Logger.js';

export class ModuleGraph {
  private nodes: Map<string, ModuleGraphNode> = new Map();
  private root: string | null = null;

  build(descriptors: ModuleDescriptor[], projectRoot: string): ModuleGraphType {
    this.nodes.clear();

    for (const desc of descriptors) {
      desc.relativePath = desc.relativePath.replace(/\\/g, '/');
    }

    const descNameMap = new Map<string, ModuleDescriptor>();

    for (const desc of descriptors) {
      let nodeName = desc.relativePath !== '.' ? desc.relativePath : desc.name;
      (desc as { name: string }).name = nodeName;
      if (this.nodes.has(nodeName)) {
        const existing = this.nodes.get(nodeName)!;

        if (existing.relativePath === desc.relativePath) {
          log.debug(`ModuleGraph: skipping duplicate scan of "${desc.name}" at "${desc.relativePath}"`);
          continue;
        }

        const existingRelativePath = existing.relativePath;
        const isExistingRoot = existingRelativePath === '.';

        if (!isExistingRoot) {
          this.nodes.delete(nodeName);
          existing.name = existingRelativePath;
          this.nodes.set(existingRelativePath, existing);

          const existingDesc = descNameMap.get(nodeName);
          if (existingDesc) {
            (existingDesc as { name: string }).name = existingRelativePath;
            descNameMap.delete(nodeName);
            descNameMap.set(existingRelativePath, existingDesc);
          }
          log.warn(`ModuleGraph: renamed existing "${nodeName}" → "${existingRelativePath}" (name collision)`);
        }

        nodeName = desc.relativePath;
        if (this.nodes.has(nodeName)) {
          log.warn(`ModuleGraph: skipping "${desc.name}" at "${desc.relativePath}" — cannot disambiguate`);
          continue;
        }
        log.warn(`ModuleGraph: resolved "${desc.name}" → "${nodeName}" (collided with "${existing.relativePath}")`);
        (desc as { name: string }).name = nodeName;
      }

      descNameMap.set(nodeName, desc);
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
        const childNode = ModuleGraph.findModuleByName(descriptors, sub.name, sub.path, desc.relativePath);
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
    subPath?: string,
    parentRelPath?: string,
  ): ModuleDescriptor | undefined {
    if (parentRelPath) {
      const baseRelPath = parentRelPath !== '.' ? parentRelPath : '';

      if (subPath) {
        const cleanPath = subPath.replace(/^\.\//, '');
        const fullPath = baseRelPath ? `${baseRelPath}/${cleanPath}` : cleanPath;
        const byFullPath = descriptors.find((d) => d.relativePath === fullPath);
        if (byFullPath) return byFullPath;
      }

      const namePath = baseRelPath ? `${baseRelPath}/${name}` : name;
      const byNamePath = descriptors.find((d) => d.relativePath === namePath);
      if (byNamePath) return byNamePath;
    }

    const match = descriptors.find((d) => d.name === name);
    if (match) return match;

    const byRelPath = descriptors.find((d) => d.relativePath === name);
    if (byRelPath) return byRelPath;

    return undefined;
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
