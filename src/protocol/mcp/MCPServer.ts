import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import { CommunicationBus } from './CommunicationBus.js';
import fs from 'fs-extra';
import path from 'path';

export interface MCPServerOptions {
  name?: string;
  version?: string;
  projectRoot?: string;
}

export class MCPServer {
  private server: Server;
  private bus: CommunicationBus;
  private projectRoot: string;

  constructor(bus: CommunicationBus, options: MCPServerOptions = {}) {
    this.bus = bus;
    this.projectRoot = options.projectRoot || process.cwd();

    this.server = new Server(
      {
        name: options.name || 'module-agent-mcp',
        version: options.version || '0.1.0',
      },
      {
        capabilities: { tools: {} },
      },
    );

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'module_list',
          description: '列出项目中所有可用的模块及其描述',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
        {
          name: 'module_call',
          description: '向目标模块发送任务请求并等待结果',
          inputSchema: {
            type: 'object' as const,
            properties: {
              targetModule: { type: 'string', description: '目标模块名称' },
              task: { type: 'string', description: '任务描述' },
              context: {
                type: 'string',
                description: '可选的上下文信息（JSON字符串）',
              },
            },
            required: ['targetModule', 'task'],
          },
        },
        {
          name: 'module_query',
          description: '向目标模块查询信息',
          inputSchema: {
            type: 'object' as const,
            properties: {
              targetModule: { type: 'string', description: '目标模块名称' },
              query: { type: 'string', description: '查询内容' },
            },
            required: ['targetModule', 'query'],
          },
        },
        {
          name: 'file_access',
          description: '跨模块文件读写操作',
          inputSchema: {
            type: 'object' as const,
            properties: {
              module: { type: 'string', description: '目标模块名称' },
              filePath: { type: 'string', description: '相对于模块根目录的文件路径' },
              operation: { type: 'string', enum: ['read', 'write'], description: '操作类型' },
              content: { type: 'string', description: '写入内容（write 操作时必填）' },
            },
            required: ['module', 'filePath', 'operation'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'module_list':
            return this.handleModuleList();
          case 'module_call':
            return this.handleModuleCall(args ?? {});
          case 'module_query':
            return this.handleModuleQuery(args ?? {});
          case 'file_access':
            return this.handleFileAccess(args ?? {});
          default:
            return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    });
  }

  private async handleModuleList() {
    const modules = this.bus.listModules();
    const result = modules.map((m) => `- **${m.name}**: ${m.description} (路径: ${m.path})`).join('\n');
    return { content: [{ type: 'text' as const, text: result || '无可用模块' }] };
  }

  private async handleModuleCall(args: Record<string, unknown>) {
    const targetModule = args.targetModule as string;
    const task = args.task as string;
    let context: Record<string, unknown> | undefined;
    if (args.context && typeof args.context === 'string') {
      try { context = JSON.parse(args.context); } catch {}
    }

    const result = await this.bus.sendToModule({ targetModule, task, context });
    const text = result.success
      ? `模块 ${targetModule} 调用成功:\n${result.result || '(无返回内容)'}`
      : `模块 ${targetModule} 调用失败: ${result.error}`;
    return { content: [{ type: 'text' as const, text }] };
  }

  private async handleModuleQuery(args: Record<string, unknown>) {
    const targetModule = args.targetModule as string;
    const query = args.query as string;

    const result = await this.bus.queryModule({ targetModule, query });
    const text = result.success
      ? `查询结果:\n${result.answer || '(无返回内容)'}`
      : `查询失败: ${result.error}`;
    return { content: [{ type: 'text' as const, text }] };
  }

  private async handleFileAccess(args: Record<string, unknown>) {
    const moduleName = args.module as string;
    const filePath = args.filePath as string;
    const operation = args.operation as string;

    const modules = this.bus.listModules();
    const mod = modules.find((m) => m.name === moduleName);
    if (!mod) {
      return { content: [{ type: 'text' as const, text: `模块未找到: ${moduleName}` }], isError: true };
    }

    const fullPath = path.join(this.projectRoot, mod.path, filePath);

    if (operation === 'read') {
      if (!await fs.pathExists(fullPath)) {
        return { content: [{ type: 'text' as const, text: `文件未找到: ${filePath}` }], isError: true };
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      return { content: [{ type: 'text' as const, text: content }] };
    }

    if (operation === 'write') {
      const content = args.content as string;
      if (content === undefined) {
        return { content: [{ type: 'text' as const, text: '写入操作需要 content 参数' }], isError: true };
      }
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
      return { content: [{ type: 'text' as const, text: `文件写入成功: ${filePath}` }] };
    }

    return { content: [{ type: 'text' as const, text: `未知操作: ${operation}` }], isError: true };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    console.error('[MCPServer] Starting with tools: module_list, module_call, module_query, file_access');
    await this.server.connect(transport);
    console.error('[MCPServer] Connected to stdio transport');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
