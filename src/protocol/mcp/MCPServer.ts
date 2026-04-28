import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import { CommunicationBus } from './CommunicationBus.js';
import fs from 'fs-extra';
import path from 'path';

export interface MCPServerOptions {
  name?: string;
  version?: string;
  projectRoot?: string;
  moduleName?: string;
}

export class MCPServer {
  private server: McpServer;
  private bus: CommunicationBus;
  private projectRoot: string;
  private moduleName: string;

  constructor(bus: CommunicationBus, options: MCPServerOptions = {}) {
    this.bus = bus;
    this.projectRoot = options.projectRoot || process.cwd();
    this.moduleName = options.moduleName || '';

    this.server = new McpServer(
      {
        name: options.name || 'module-agent-mcp',
        version: options.version || '0.1.0',
      },
      {
        capabilities: { tools: {} },
      },
    );

    this.registerTools();
  }

  private registerTools(): void {
    this.server.registerTool(
      'module_list',
      {
        description: '列出项目中所有可用的模块及其描述',
        inputSchema: z.object({}),
      },
      async () => {
        const modules = this.bus.listModules();
        const result = modules.map((m) => `- **${m.name}**: ${m.description} (路径: ${m.path})`).join('\n');
        return { content: [{ type: 'text', text: result || '无可用模块' }] };
      },
    );

    this.server.registerTool(
      'module_call',
      {
        description: '向目标模块发送任务请求并等待结果',
        inputSchema: z.object({
          targetModule: z.string().describe('目标模块名称'),
          task: z.string().describe('任务描述'),
          context: z.string().optional().describe('可选的上下文信息（JSON字符串）'),
        }),
      },
      async (args) => {
        let contextObj: Record<string, unknown> | undefined;
        if (args.context) {
          try { contextObj = JSON.parse(args.context); } catch {}
        }
        const result = await this.bus.sendToModule({ targetModule: args.targetModule, task: args.task, context: contextObj, requestingModule: this.moduleName });
        const text = result.success
          ? `模块 ${args.targetModule} 调用成功:\n${result.result || '(无返回内容)'}`
          : `模块 ${args.targetModule} 调用失败: ${result.error}`;
        return { content: [{ type: 'text', text }] };
      },
    );

    this.server.registerTool(
      'module_query',
      {
        description: '向目标模块查询信息',
        inputSchema: z.object({
          targetModule: z.string().describe('目标模块名称'),
          query: z.string().describe('查询内容'),
        }),
      },
      async (args) => {
        const result = await this.bus.queryModule({ targetModule: args.targetModule, query: args.query, requestingModule: this.moduleName });
        const text = result.success
          ? `查询结果:\n${result.answer || '(无返回内容)'}`
          : `查询失败: ${result.error}`;
        return { content: [{ type: 'text', text }] };
      },
    );

    this.server.registerTool(
      'file_access',
      {
        description: '跨模块文件读写操作',
        inputSchema: z.object({
          module: z.string().describe('目标模块名称'),
          filePath: z.string().describe('相对于模块根目录的文件路径'),
          operation: z.enum(['read', 'write']).describe('操作类型'),
          content: z.string().optional().describe('写入内容（write 操作时必填）'),
        }),
      },
      async (args) => {
        const modules = this.bus.listModules();
        const mod = modules.find((m) => m.name === args.module);
        if (!mod) {
          return { content: [{ type: 'text', text: `模块未找到: ${args.module}` }], isError: true };
        }

        const fullPath = path.join(this.projectRoot, mod.path, args.filePath);

        if (args.operation === 'read') {
          if (!await fs.pathExists(fullPath)) {
            return { content: [{ type: 'text', text: `文件未找到: ${args.filePath}` }], isError: true };
          }
          const content = await fs.readFile(fullPath, 'utf-8');
          return { content: [{ type: 'text', text: content }] };
        }

        if (args.operation === 'write') {
          if (args.content === undefined) {
            return { content: [{ type: 'text', text: '写入操作需要 content 参数' }], isError: true };
          }
          await fs.ensureDir(path.dirname(fullPath));
          await fs.writeFile(fullPath, args.content, 'utf-8');
          return { content: [{ type: 'text', text: `文件写入成功: ${args.filePath}` }] };
        }

        return { content: [{ type: 'text', text: `未知操作: ${args.operation}` }], isError: true };
      },
    );
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
