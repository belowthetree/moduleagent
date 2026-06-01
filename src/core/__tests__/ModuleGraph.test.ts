// ---------------------------------------------------------------------------
// core/__tests__/ModuleGraph.test.ts — 模块依赖图单元测试
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { ModuleGraph } from '../ModuleGraph.js';
import type { ModuleDescriptor } from '../../types/module.js';

function createDescriptor(overrides: Partial<ModuleDescriptor> = {}): ModuleDescriptor {
  const { definition: defOverride, ...rest } = overrides;
  const baseDefinition = {
    frontmatter: { name: rest.name ?? 'root', description: '' },
    body: '',
    description: '',
    subModules: [] as Array<{ name: string; path: string; description: string }>,
    ...(defOverride ?? {}),
  };
  return {
    name: 'root',
    rootPath: '/fake/project',
    relativePath: '.',
    moduleMdPath: '/fake/project/module.md',
    definition: baseDefinition,
    ...rest,
  };
}

function createChildDescriptor(
  name: string,
  relativePath: string,
  parentPath?: string,
): ModuleDescriptor {
  return createDescriptor({
    name,
    rootPath: `/fake/project/${relativePath}`,
    relativePath,
    moduleMdPath: `/fake/project/${relativePath}/module.md`,
  });
}

describe('ModuleGraph', () => {
  describe('build', () => {
    it('builds a single-node graph from a root module', () => {
      const graph = new ModuleGraph();
      const desc = createDescriptor();
      const result = graph.build([desc], '/fake/project');

      expect(result.root).toBe('root');
      expect(result.nodes.size).toBe(1);
      expect(result.nodes.get('root')?.parent).toBeNull();
      expect(result.nodes.get('root')?.children).toEqual([]);
    });

    it('throws when no modules are provided', () => {
      const graph = new ModuleGraph();
      expect(() => graph.build([], '/fake/project')).toThrow('No modules found');
    });

    it('throws when no root module (relativePath ".") exists', () => {
      const graph = new ModuleGraph();
      const desc = createChildDescriptor('sub', 'sub');
      expect(() => graph.build([desc], '/fake/project')).toThrow('Root module');
    });

    it('builds parent-child relationships from subModules in definition', () => {
      const graph = new ModuleGraph();
      const rootDesc: ModuleDescriptor = {
        ...createDescriptor(),
        definition: {
          frontmatter: { name: 'root', description: '' },
          body: '',
          description: '',
          subModules: [{ name: 'sub-a', path: 'sub-a', description: '' }],
        },
      };
      const subADesc = createChildDescriptor('sub-a', 'sub-a');

      const result = graph.build([rootDesc, subADesc], '/fake/project');

      const root = result.nodes.get('root');
      const subA = result.nodes.get('sub-a');
      expect(root?.children).toEqual(['sub-a']);
      expect(subA?.parent).toBe('root');
    });

    it('builds nested module hierarchies', () => {
      const graph = new ModuleGraph();
      const rootDesc: ModuleDescriptor = {
        ...createDescriptor(),
        definition: {
          frontmatter: { name: 'root', description: '' },
          body: '',
          description: '',
          subModules: [{ name: 'services', path: 'services', description: '' }],
        },
      };
      const servicesDesc: ModuleDescriptor = {
        ...createChildDescriptor('services', 'services'),
        definition: {
          frontmatter: { name: 'services', description: '' },
          body: '',
          description: '',
          subModules: [{ name: 'api', path: 'api', description: '' }],
        },
      };
      const apiDesc = createChildDescriptor('api', 'services/api');

      const result = graph.build([rootDesc, servicesDesc, apiDesc], '/fake/project');

      const services = result.nodes.get('services');
      const api = result.nodes.get('services/api');
      // Children are referenced by their node names, which are relativePaths
      expect(services?.children).toEqual(['services/api']);
      expect(api?.parent).toBe('services');
    });

    it('skips duplicate descriptors', () => {
      const graph = new ModuleGraph();
      const desc = createDescriptor();
      const result = graph.build([desc, desc], '/fake/project');
      expect(result.nodes.size).toBe(1);
    });

    it('handles name collision by falling back to relativePath', () => {
      const graph = new ModuleGraph();
      const rootDesc = createDescriptor();
      // Module at 'lib' relative path also named 'root'
      const libDesc: ModuleDescriptor = {
        ...createChildDescriptor('root', 'lib'),
        definition: {
          frontmatter: { name: 'root', description: '' },
          body: '',
          description: '',
          subModules: [],
        },
      };

      const result = graph.build([rootDesc, libDesc], '/fake/project');

      // The root module should stay as 'root', the lib module renamed to 'lib'
      expect(result.nodes.has('root')).toBe(true);
      expect(result.nodes.has('lib')).toBe(true);
      expect(result.nodes.get('root')?.relativePath).toBe('.');
      expect(result.nodes.get('lib')?.relativePath).toBe('lib');
    });
  });

  describe('getSubtreeNames', () => {
    it('returns all descendant names excluding the start node', () => {
      const graphInstance = new ModuleGraph();
      const rootDesc: ModuleDescriptor = {
        ...createDescriptor(),
        definition: {
          frontmatter: { name: 'root', description: '' },
          body: '',
          description: '',
          subModules: [{ name: 'a', path: 'a', description: '' }],
        },
      };
      const aDesc: ModuleDescriptor = {
        ...createChildDescriptor('a', 'a'),
        definition: {
          frontmatter: { name: 'a', description: '' },
          body: '',
          description: '',
          subModules: [
            { name: 'b', path: 'b', description: '' },
            { name: 'c', path: 'c', description: '' },
          ],
        },
      };
      const bDesc = createChildDescriptor('b', 'a/b');
      const cDesc = createChildDescriptor('c', 'a/c');
      const graph = graphInstance.build([rootDesc, aDesc, bDesc, cDesc], '/fake/project');

      const subtree = ModuleGraph.getSubtreeNames(graph, 'a');
      expect(subtree.sort()).toEqual(['a/b', 'a/c']);
    });

    it('returns empty array for leaf nodes', () => {
      const graphInstance = new ModuleGraph();
      const rootDesc = createDescriptor();
      const graph = graphInstance.build([rootDesc], '/fake/project');

      const subtree = ModuleGraph.getSubtreeNames(graph, 'root');
      expect(subtree).toEqual([]);
    });
  });
});
