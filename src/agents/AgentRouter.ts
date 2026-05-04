import fs from 'fs';
import path from 'path';
import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { AgentManager, AgentEntry } from './AgentManager.js';
import type { PromptResponse } from '@agentclientprotocol/sdk';
import { defaultLogger as log } from '../core/Logger.js';
import { buildPromptBlocks, loadSystemPrompts } from './PromptBuilder.js';

/**
 * Walk up the directory tree from `startDir` until `package.json` is found.
 * Returns the repo root directory, or null if not found within 10 levels.
 */
function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Resolve the config directory (<repo-root>/config/) regardless of whether
 * the code runs from source (ESM via import.meta.url) or from a bundled
 * esbuild output (CJS via __dirname).
 */
function resolveConfigDir(): string {
  let moduleDir: string | null = null;

  // ESM: use import.meta.url (accurate under source and tsx)
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    try {
      moduleDir = path.dirname(new URL(import.meta.url).pathname);
    } catch { /* fall through */ }
  }

  // CJS: __dirname available in esbuild output (dist/) or direct CJS loaders
  if (!moduleDir && typeof __dirname !== 'undefined') {
    moduleDir = __dirname;
  }

  if (moduleDir) {
    const root = findPackageRoot(moduleDir);
    if (root) {
      return path.join(root, 'config');
    }
  }

  // Last resort: cwd + config (may be wrong but better than crashing)
  return path.resolve(process.cwd(), 'config');
}

const PKG_CONFIG_DIR = resolveConfigDir();

export interface RoutedMessage {
  targetName: string;
  prompt: string;
}

export class AgentRouter {
  private manager: AgentManager;
  private graph: ModuleGraphType;
  private sessionPrompted = new Set<string>();
  private promptDir: string;
  private prompts: { mainPrompt: string; subPrompt: string };

  constructor(manager: AgentManager, graph: ModuleGraphType, promptDir?: string) {
    this.manager = manager;
    this.graph = graph;
    this.promptDir = promptDir || PKG_CONFIG_DIR;
    this.prompts = loadSystemPrompts(path.dirname(this.promptDir));
  }

  resetSession(sessionId: string): void {
    this.sessionPrompted.delete(sessionId);
  }

  async route(message: string): Promise<RoutedMessage> {
    const keyword = this.extractModuleKeyword(message);
    if (keyword) {
      const target = this.findModule(keyword);
      if (target) {
        const agent = this.manager.getAgent(target);
        if (agent) {
          log.info(`Router: keyword="${keyword}" -> ${agent.name}`);
          return { targetName: agent.name, prompt: message };
        }
      }
    }

    const pathMatch = this.extractFilePath(message);
    if (pathMatch) {
      const target = this.findModuleByFile(pathMatch);
      if (target && target !== this.graph.root) {
        const agent = this.manager.getAgent(target);
        if (agent) {
          log.info(`Router: file="${pathMatch}" -> ${agent.name}`);
          return { targetName: agent.name, prompt: message };
        }
      }
    }

    const main = this.manager.getMainAgent();
    const targetName = main?.name || 'main';
    log.info(`Router: default -> ${targetName}`);
    return { targetName, prompt: message };
  }

  async sendToAgent(entry: AgentEntry, prompt: string): Promise<PromptResponse> {
    const blocks = buildPromptBlocks({
      moduleName: entry.name,
      userText: prompt,
      graph: this.graph,
      prompts: this.prompts,
      sessionPrompted: this.sessionPrompted,
    });

    log.info(`Router: sending to ${entry.name} (${prompt.length} chars, ${blocks.length} blocks)`);
    try {
      return await entry.agent.connection.prompt({
        sessionId: entry.sessionId!,
        prompt: blocks,
      });
    } catch (err) {
      log.error(`Router: prompt failed for ${entry.name} | ${(err as Error).message}`);
      throw err;
    }
  }

  async cancelAgent(entry: AgentEntry): Promise<void> {
    await entry.agent.connection.cancel({ sessionId: entry.sessionId! });
  }

  private extractModuleKeyword(message: string): string | null {
    const match = message.match(/^@(\w[\w-]*)\b/);
    if (match) return match[1]!;

    const moduleMatch = message.match(/模块\s*[:：]?\s*(\w[\w-]*)/);
    if (moduleMatch) return moduleMatch[1]!;

    const toMatch = message.match(/交给\s*(\w[\w-]*)\s*(模块|agent)?/);
    if (toMatch) return toMatch[1]!;

    return null;
  }

  private extractFilePath(message: string): string | null {
    const match = message.match(/(?:^|\s)([a-zA-Z0-9_/.-]+\.[a-zA-Z]+)(?:\s|$)/);
    return match ? match[1]! : null;
  }

  private findModule(keyword: string): string | undefined {
    const lower = keyword.toLowerCase();
    for (const [name] of this.graph.nodes) {
      if (name.toLowerCase() === lower) return name;
    }
    for (const [name] of this.graph.nodes) {
      if (name.toLowerCase().includes(lower)) return name;
    }
    return undefined;
  }

  private findModuleByFile(filePath: string): string | undefined {
    for (const [name, node] of this.graph.nodes) {
      if (filePath.startsWith(node.relativePath) || filePath.includes(node.relativePath)) {
        return name;
      }
    }
    return undefined;
  }
}
