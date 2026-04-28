import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { AgentManager, AgentEntry } from './AgentManager.js';
import type { PromptResponse } from '@agentclientprotocol/sdk';

export interface RoutedMessage {
  targetName: string;
  prompt: string;
}

export class AgentRouter {
  private manager: AgentManager;
  private graph: ModuleGraphType;

  constructor(manager: AgentManager, graph: ModuleGraphType) {
    this.manager = manager;
    this.graph = graph;
  }

  async route(message: string): Promise<RoutedMessage> {
    const keyword = this.extractModuleKeyword(message);
    if (keyword) {
      const target = this.findModule(keyword);
      if (target) {
        const agent = this.manager.getAgent(target);
        if (agent) {
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
          return { targetName: agent.name, prompt: message };
        }
      }
    }

    const main = this.manager.getMainAgent();
    return { targetName: main?.name || 'main', prompt: message };
  }

  async sendToAgent(entry: AgentEntry, prompt: string): Promise<PromptResponse> {
    return entry.agent.connection.prompt({
      sessionId: entry.sessionId!,
      prompt: [{ type: 'text', text: prompt }],
    });
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
