// ---------------------------------------------------------------------------
// types/module.ts — 模块类型定义
// 包含模块描述文件（module.md）相关的前置元数据、子模块引用、图节点和描述符类型
// ---------------------------------------------------------------------------

export interface ModuleFrontmatter {
  name: string;
  description: string;
  submodules?: SubModuleRef[];
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
