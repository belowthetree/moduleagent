import type { ModuleGraphNode } from '../../types/module.js';

export interface CliResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ModuleListItem {
  name: string;
  path: string;
  description: string;
  children: string[];
  parent: string | null;
}

export interface ModuleDetail extends ModuleListItem {
  absolutePath: string;
  frontmatter: {
    name: string;
    description: string;
    submodules: { name: string; path: string; description: string }[];
  };
  body: string;
}

export function writeJson<T>(data: T): void {
  process.stdout.write(JSON.stringify({ success: true, data }) + '\n');
}

export function writeError(exitCode: number, message: string): never {
  process.stderr.write(JSON.stringify({ success: false, error: message }) + '\n');
  process.exit(exitCode);
}

export class CliError extends Error {
  constructor(
    public exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function nodeToListItem(node: ModuleGraphNode): ModuleListItem {
  return {
    name: node.name,
    path: node.relativePath,
    description: node.definition.frontmatter.description,
    children: node.children,
    parent: node.parent,
  };
}

export function nodeToDetail(node: ModuleGraphNode): ModuleDetail {
  return {
    name: node.name,
    path: node.relativePath,
    absolutePath: node.absolutePath,
    description: node.definition.frontmatter.description,
    parent: node.parent,
    children: node.children,
    frontmatter: {
      name: node.definition.frontmatter.name,
      description: node.definition.frontmatter.description,
      submodules: node.definition.subModules,
    },
    body: node.definition.body,
  };
}
