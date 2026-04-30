import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ModuleGraph as ModuleGraphType } from '../../types/module.js';
import { CommunicationBus } from './CommunicationBus.js';

export interface MCPServerOptions {
  name?: string;
  version?: string;
  moduleName?: string;
}

export class MCPServer {
  private server: McpServer;
  private bus: CommunicationBus;
  private moduleName: string;

  constructor(bus: CommunicationBus, options: MCPServerOptions = {}) {
    this.bus = bus;
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
        const modules = this.bus.listModules(this.moduleName);
        const result = modules.map((m) => `- **${m.name}**: ${m.description} (路径: ${m.path})`).join('\n');
        return { content: [{ type: 'text', text: result || '无可用模块' }] };
      },
    );

    this.server.registerTool(
      'module_call',
      {
        description: '向目标模块发送任务请求并等待结果。请按结构化格式填写各字段，便于目标模块准确理解任务。',
        inputSchema: z.object({
          targetModule: z.string().describe('目标模块名称'),
          goal: z.string().describe('任务目标：需要完成什么，尽量具体可执行'),
          background: z.string().describe('背景：为什么需要此任务，在整体目标中的位置'),
          expectedOutput: z.string().describe('预期输出：需要返回什么格式和内容'),
          constraints: z.string().describe('约束条件：禁止做的事情，范围限定'),
        }),
      },
      async (args) => {
        const taskText = [
          `[跨模块请求]`,
          `来源: ${this.moduleName || '(主模块)'}`,
          `目标: ${args.goal}`,
          `背景: ${args.background}`,
          `预期输出: ${args.expectedOutput}`,
          `约束: ${args.constraints}`,
          `---`,
          `请在模块范围内完成上述任务。`,
        ].join('\n');

        const result = await this.bus.sendToModule({
          targetModule: args.targetModule,
          task: taskText,
          context: { requestingModule: this.moduleName, timestamp: Date.now() },
          requestingModule: this.moduleName,
        });
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
          background: z.string().describe('查询背景：为什么需要此信息'),
        }),
      },
      async (args) => {
        const queryText = [
          `[查询请求，来自: ${this.moduleName || '(主模块)'}]`,
          `背景: ${args.background}`,
          `查询: ${args.query}`,
        ].join('\n');

        const result = await this.bus.queryModule({ targetModule: args.targetModule, query: queryText, requestingModule: this.moduleName });
        const text = result.success
          ? `查询结果:\n${result.answer || '(无返回内容)'}`
          : `查询失败: ${result.error}`;
        return { content: [{ type: 'text', text }] };
      },
    );

    this.server.registerTool(
      'create_module',
      {
        description: '根据模块创建标准新建模块，包括创建模块文件夹、module.md文件，并更新模块节点树',
        inputSchema: z.object({
          name: z.string().describe('新模块的名称（只能包含字母、数字、连字符和下划线）'),
          parentPath: z.string().optional().describe('父模块的相对路径，不指定则在项目根目录创建'),
          description: z.string().optional().describe('模块描述，不指定则自动生成'),
        }),
      },
      async (args) => {
        const result = await this.bus.createModule({
          name: args.name,
          parentPath: args.parentPath,
          description: args.description,
        });
        const text = result.success
          ? `模块创建成功:\n${result.message}\n路径: ${result.modulePath}`
          : `模块创建失败: ${result.message}`;
        return { content: [{ type: 'text', text }] };
      },
    );

  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    console.error('[MCPServer] Starting with tools: module_list, module_call, module_query, create_module');
    await this.server.connect(transport);
    console.error('[MCPServer] Connected to stdio transport');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
