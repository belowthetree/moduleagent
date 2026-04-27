export interface SourceConfig {
  type: 'git' | 'local';
  url?: string;
  branch?: string;
  path?: string;
}

export interface ModuleFrontmatter {
  name: string;
  description: string;
  source?: SourceConfig;
}

export interface SubModuleRef {
  name: string;
  path: string;
  description: string;
}

export interface ModuleDefinition {
  frontmatter: ModuleFrontmatter;
  body: string;
  description: string;
  subModules: SubModuleRef[];
}

export interface ModuleDescriptor {
  name: string;
  rootPath: string;
  relativePath: string;
  moduleMdPath: string;
  definition: ModuleDefinition;
}

export interface ModuleGraphNode {
  name: string;
  absolutePath: string;
  relativePath: string;
  parent: string | null;
  children: string[];
  definition: ModuleDefinition;
  workspacePath?: string;
}

export interface ModuleGraph {
  root: string;
  nodes: Map<string, ModuleGraphNode>;
}
