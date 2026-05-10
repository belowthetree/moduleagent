import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
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

    this.server.registerTool(
      'module_doc_update',
      {
        description:
          '更新当前模块的 module.md 文件。在修改代码后必须调用此工具同步更新模块文档，包括 API 变更、新增依赖、职责变化等。传入完整的 Markdown 内容（含 YAML frontmatter），将完整替换现有 module.md。',
        inputSchema: z.object({
          content: z.string().describe('完整的 Markdown 内容，包含 YAML frontmatter（以 --- 开头）。将完整替换现有 module.md。'),
        }),
      },
      async (args) => {
        console.error(`[MCPServer] module_doc_update [${this.moduleName}] invoked (${args.content.length} chars)`);
        const result = await this.bus.updateModuleDoc(this.moduleName, args.content);
        return {
          content: [{ type: 'text', text: result.success ? `模块文档已更新: ${result.message}` : `更新失败: ${result.message}` }],
        };
      },
    );

    this.server.registerTool(
      'module_doc_record',
      {
        description:
          '记录任务经验或修改规范到模块文档。经验会追加到 experience.md，修改规范会追加到 patterns.md（如同名规范已存在则替换旧内容）。',
        inputSchema: z.object({
          type: z.enum(['experience', 'pattern']).describe('记录类型：experience=任务经验，pattern=修改规范'),
          title: z.string().describe('标题，简要概括记录内容'),
          body: z.string().describe('正文（Markdown 格式）。对 pattern 类型，应包含：触发条件、必须同时修改的内容、原因说明。'),
          tags: z.array(z.string()).optional().describe('标签列表，用于后续搜索匹配相关经验'),
        }),
      },
      async (args) => {
        console.error(`[MCPServer] module_doc_record [${this.moduleName}] type=${args.type} title="${args.title}"`);
        const result = await this.bus.recordToModuleDoc(this.moduleName, args.type, args.title, args.body, args.tags);
        return {
          content: [{ type: 'text', text: result.success ? `已记录: ${result.message}` : `记录失败: ${result.message}` }],
        };
      },
    );

  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    console.error('[MCPServer] Starting with tools: module_list, module_call, module_query, create_module, module_doc_update, module_doc_record');
    await this.server.connect(transport);
    console.error('[MCPServer] Connected to stdio transport');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
