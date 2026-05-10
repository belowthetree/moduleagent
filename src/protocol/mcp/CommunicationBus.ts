import type { ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../../types/module.js';
import fs from 'fs-extra';
import path from 'path';
import { ModuleGenerator } from '../../core/ModuleGenerator.js';

export interface ModuleCallRequest {
  targetModule: string;
  task: string;
  context?: Record<string, unknown>;
  requestingModule?: string;
}

export interface ModuleCallResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ModuleQueryRequest {
  targetModule: string;
  query: string;
  requestingModule?: string;
}

export interface ModuleQueryResult {
  success: boolean;
  answer?: string;
  error?: string;
}

export type MessageHandler = (message: ModuleCallRequest | ModuleQueryRequest) => Promise<ModuleCallResult | ModuleQueryResult>;

export class CommunicationBus {
  private moduleGraph: ModuleGraphType | null = null;
  private messageHandler: MessageHandler | null = null;
  private graphFile: string | null = null;

  setModuleGraph(graph: ModuleGraphType): void {
    this.moduleGraph = graph;
  }

  setGraphFile(filePath: string): void {
    this.graphFile = filePath;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  private getAccessibleModules(requestingModule: string): Set<string> {
    const accessible = new Set<string>();
    if (!this.moduleGraph) return accessible;

    const node = this.moduleGraph.nodes.get(requestingModule);
    if (!node) return accessible;

    accessible.add(requestingModule);
    for (const child of node.children) accessible.add(child);
    if (node.parent) accessible.add(node.parent);

    return accessible;
  }

  private checkAccess(requestingModule: string | undefined, targetModule: string): boolean {
    if (!requestingModule) return true;
    if (!this.moduleGraph) return false;

    const root = this.moduleGraph.root;
    if (requestingModule === root) return true;

    const accessible = this.getAccessibleModules(requestingModule);
    return accessible.has(targetModule);
  }

  async sendToModule(request: ModuleCallRequest): Promise<ModuleCallResult> {
    if (!this.moduleGraph) {
      return { success: false, error: 'Module graph not initialized' };
    }

    if (!this.checkAccess(request.requestingModule, request.targetModule)) {
      return { success: false, error: `Access denied: cannot communicate with module "${request.targetModule}"` };
    }

    const targetNode = this.moduleGraph.nodes.get(request.targetModule);
    if (!targetNode) {
      return { success: false, error: `Module not found: ${request.targetModule}` };
    }

    if (this.messageHandler) {
      return await this.messageHandler(request) as ModuleCallResult;
    }

    return { success: false, error: 'No message handler registered' };
  }

  async queryModule(request: ModuleQueryRequest): Promise<ModuleQueryResult> {
    if (!this.moduleGraph) {
      return { success: false, error: 'Module graph not initialized' };
    }

    if (!this.checkAccess(request.requestingModule, request.targetModule)) {
      return { success: false, error: `Access denied: cannot communicate with module "${request.targetModule}"` };
    }

    const targetNode = this.moduleGraph.nodes.get(request.targetModule);
    if (!targetNode) {
      return { success: false, error: `Module not found: ${request.targetModule}` };
    }

    if (this.messageHandler) {
      return await this.messageHandler(request) as ModuleQueryResult;
    }

    return { success: false, error: 'No message handler registered' };
  }

  listModules(requestingModule?: string): { name: string; description: string; path: string }[] {
    if (!this.moduleGraph) return [];

    const accessible = requestingModule ? this.getAccessibleModules(requestingModule) : null;
    const root = this.moduleGraph.root;

    const result: { name: string; description: string; path: string }[] = [];
    for (const [name, node] of this.moduleGraph.nodes) {
      if (accessible && requestingModule !== root && !accessible.has(name)) continue;
      result.push({
        name,
        description: node.definition.frontmatter.description,
        path: node.relativePath,
      });
    }
    return result;
  }

  async createModule(options: {
    name: string;
    parentPath?: string;
    description?: string;
  }): Promise<{ success: boolean; message: string; modulePath?: string }> {
    if (!this.moduleGraph) {
      return { success: false, message: 'Module graph not initialized' };
    }

    const { name, parentPath, description } = options;

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return { success: false, message: 'Module name can only contain letters, numbers, hyphens, and underscores' };
    }

    if (this.moduleGraph.nodes.has(name)) {
      return { success: false, message: `Module "${name}" already exists` };
    }

    const rootNode = this.moduleGraph.nodes.get(this.moduleGraph.root);
    if (!rootNode) {
      return { success: false, message: 'Root node not found in graph' };
    }
    const projectRoot = rootNode.absolutePath;

    let targetDir: string;
    let relativePath: string;
    let parentName: string;

    if (parentPath) {
      const parentNode = this.findModuleByPath(parentPath);
      if (!parentNode) {
        return { success: false, message: `Parent path "${parentPath}" does not correspond to any existing module` };
      }
      parentName = parentNode.name;
      targetDir = path.join(projectRoot, parentPath, name);
      relativePath = path.posix.join(parentPath, name);
    } else {
      parentName = this.moduleGraph.root;
      targetDir = path.join(projectRoot, name);
      relativePath = name;
    }

    try {
      await fs.ensureDir(targetDir);
    } catch (err) {
      return { success: false, message: `Failed to create directory: ${(err as Error).message}` };
    }

    const desc = description || `${name} 模块`;
    const moduleMdContent = ModuleGenerator.createModuleMd(name, desc);

    try {
      await fs.writeFile(path.join(targetDir, 'module.md'), moduleMdContent, 'utf-8');
      await fs.writeFile(path.join(targetDir, 'experience.md'), `# ${name} — 经验记录\n\n`, 'utf-8');
      await fs.writeFile(path.join(targetDir, 'patterns.md'), `# ${name} — 修改规范\n\n`, 'utf-8');
    } catch (err) {
      return { success: false, message: `Failed to write module docs: ${(err as Error).message}` };
    }

    const newNode: ModuleGraphNode = {
      name,
      absolutePath: targetDir,
      relativePath,
      parent: parentName,
      children: [],
      definition: {
        frontmatter: { name, description: desc },
        body: `# ${name}\n\n## 模块说明\n\n待补充\n`,
        description: desc,
        subModules: [],
      },
    };

    this.moduleGraph.nodes.set(name, newNode);

    const parentGraphNode = this.moduleGraph.nodes.get(parentName);
    if (parentGraphNode) {
      parentGraphNode.children.push(name);
    }

    try {
      await this.persistGraph();
    } catch (err) {
      return { success: false, message: `Module created but failed to persist graph: ${(err as Error).message}` };
    }

    return {
      success: true,
      message: `Module "${name}" created successfully at ${relativePath}`,
      modulePath: relativePath,
    };
  }

  private findModuleByPath(relativePath: string): ModuleGraphNode | undefined {
    if (!this.moduleGraph) return undefined;
    for (const [, node] of this.moduleGraph.nodes) {
      if (node.relativePath === relativePath) return node;
    }
    return undefined;
  }

  private async persistGraph(): Promise<void> {
    if (!this.graphFile || !this.moduleGraph) return;

    const nodesObj: Record<string, ModuleGraphNode> = {};
    for (const [name, node] of this.moduleGraph.nodes) {
      nodesObj[name] = node;
    }

    await fs.writeFile(
      this.graphFile,
      JSON.stringify({ root: this.moduleGraph.root, nodes: nodesObj }, null, 2),
      'utf-8',
    );
  }

  // ── Module doc operations ──

  async updateModuleDoc(moduleName: string, content: string): Promise<{ success: boolean; message: string }> {
    if (!this.moduleGraph) return { success: false, message: 'Module graph not initialized' };
    const node = this.moduleGraph.nodes.get(moduleName);
    if (!node) return { success: false, message: `Module not found: ${moduleName}` };

    const filePath = path.join(node.absolutePath, 'module.md');
    console.error(`[CommunicationBus] module_doc_update [${moduleName}] → ${filePath} (${content.length} chars)`);
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      console.error(`[CommunicationBus] module_doc_update [${moduleName}] done`);
      return { success: true, message: `module.md updated for "${moduleName}"` };
    } catch (err) {
      console.error(`[CommunicationBus] module_doc_update [${moduleName}] FAILED: ${(err as Error).message}`);
      return { success: false, message: `Failed to write module.md: ${(err as Error).message}` };
    }
  }

  async recordToModuleDoc(
    moduleName: string,
    type: 'experience' | 'pattern',
    title: string,
    body: string,
    tags?: string[],
  ): Promise<{ success: boolean; message: string }> {
    if (!this.moduleGraph) return { success: false, message: 'Module graph not initialized' };
    const node = this.moduleGraph.nodes.get(moduleName);
    if (!node) return { success: false, message: `Module not found: ${moduleName}` };

    const fileName = type === 'experience' ? 'experience.md' : 'patterns.md';
    const filePath = path.join(node.absolutePath, fileName);

    try {
      await fs.ensureDir(node.absolutePath);
    } catch {
      // directory exists
    }

    if (type === 'experience') {
      const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const tagsLine = tags && tags.length > 0 ? `\n标签: ${tags.join(', ')}` : '';
      const entry = `\n## ${timestamp} — ${title}\n${tagsLine}\n${body}\n`;
      console.error(`[CommunicationBus] module_doc_record experience [${moduleName}] title="${title}" → ${filePath}`);
      try {
        await fs.appendFile(filePath, entry, 'utf-8');
      } catch {
        await fs.writeFile(filePath, entry, 'utf-8');
      }
      console.error(`[CommunicationBus] module_doc_record experience [${moduleName}] done`);
      return { success: true, message: `经验已记录到 ${fileName}` };
    } else {
      console.error(`[CommunicationBus] module_doc_record pattern [${moduleName}] title="${title}" → ${filePath}`);
      await this._appendOrReplaceSection(filePath, title, body);
      console.error(`[CommunicationBus] module_doc_record pattern [${moduleName}] done`);
      return { success: true, message: `规范已记录到 ${fileName}` };
    }
  }

  private async _appendOrReplaceSection(filePath: string, title: string, content: string): Promise<void> {
    let existing = '';
    try { existing = await fs.readFile(filePath, 'utf-8'); } catch { /* file may not exist */ }

    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`(^|\\n)## ${escapedTitle}\\n[^#]*?(?=\\n## |\\n*$)`, 's');

    if (sectionRegex.test(existing)) {
      const newSection = `\n## ${title}\n\n${content}\n`;
      existing = existing.replace(sectionRegex, (_match, prefix) => {
        return (prefix || '') + newSection.trimEnd();
      });
      await fs.writeFile(filePath, existing, 'utf-8');
    } else {
      const entry = existing ? `\n## ${title}\n\n${content}\n` : `## ${title}\n\n${content}\n`;
      try {
        await fs.appendFile(filePath, entry, 'utf-8');
      } catch {
        await fs.writeFile(filePath, entry, 'utf-8');
      }
    }
  }
}
