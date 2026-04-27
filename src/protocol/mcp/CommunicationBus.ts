import type { ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../../types/module.js';

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

  setModuleGraph(graph: ModuleGraphType): void {
    this.moduleGraph = graph;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async sendToModule(request: ModuleCallRequest): Promise<ModuleCallResult> {
    if (!this.moduleGraph) {
      return { success: false, error: 'Module graph not initialized' };
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

    const result: { name: string; description: string; path: string }[] = [];
    for (const [name, node] of this.moduleGraph.nodes) {
      result.push({
        name,
        description: node.definition.frontmatter.description,
        path: node.relativePath,
      });
    }
    return result;
  }
}
