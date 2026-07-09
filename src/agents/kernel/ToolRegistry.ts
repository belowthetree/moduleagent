// ---------------------------------------------------------------------------
// agents/kernel/ToolRegistry.ts — 工具注册表
// 管理工具的注册、查询和执行
// ---------------------------------------------------------------------------

import type { Tool, ToolDefinition, ToolOutput } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  listDefinitions(): ToolDefinition[] {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        metadata: { error: true, code: 'unknown_tool' },
      };
    }

    try {
      const result = await tool.execute(input);
      return result;
    } catch (err) {
      return {
        content: JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` }),
        metadata: { error: true, code: 'execution_error' },
      };
    }
  }
}
