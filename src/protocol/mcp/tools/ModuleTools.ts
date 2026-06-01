// ---------------------------------------------------------------------------
// protocol/mcp/tools/ModuleTools.ts — MCP 工具函数
// 提供 module_call/module_query/module_list/create_module 工具的处理逻辑
// ---------------------------------------------------------------------------

import { CommunicationBus } from '../CommunicationBus.js';
import type { ModuleCallResult, ModuleQueryResult } from '../CommunicationBus.js';
import fs from 'fs-extra';
import path from 'path';

export class ModuleListTool {
  private bus: CommunicationBus;

  constructor(bus: CommunicationBus) {
    this.bus = bus;
  }

  get schema() {
    return {
      name: 'module_list' as const,
      description: '列出项目中所有可用的模块及其描述',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    };
  }

  async run(): Promise<string> {
    const modules = this.bus.listModules();
    return modules.map((m) => `- **${m.name}**: ${m.description} (路径: ${m.path})`).join('\n') || '无可用模块';
  }
}

export class ModuleCallTool {
  private bus: CommunicationBus;

  constructor(bus: CommunicationBus) {
    this.bus = bus;
  }

  get schema() {
    return {
      name: 'module_call' as const,
      description: '向目标模块发送任务请求并等待结果',
      inputSchema: {
        type: 'object' as const,
        properties: {
          targetModule: { type: 'string' as const, description: '目标模块名称' },
          task: { type: 'string' as const, description: '任务描述' },
          context: { type: 'string' as const, description: '可选的上下文信息（JSON字符串）' },
        },
        required: ['targetModule', 'task'],
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ModuleCallResult> {
    const targetModule = args.targetModule as string;
    const task = args.task as string;
    let context: Record<string, unknown> | undefined;
    if (args.context && typeof args.context === 'string') {
      try { context = JSON.parse(args.context); } catch {}
    }
    return this.bus.sendToModule({ targetModule, task, context });
  }
}

export class ModuleQueryTool {
  private bus: CommunicationBus;

  constructor(bus: CommunicationBus) {
    this.bus = bus;
  }

  get schema() {
    return {
      name: 'module_query' as const,
      description: '向目标模块查询信息',
      inputSchema: {
        type: 'object' as const,
        properties: {
          targetModule: { type: 'string' as const, description: '目标模块名称' },
          query: { type: 'string' as const, description: '查询内容' },
        },
        required: ['targetModule', 'query'],
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ModuleQueryResult> {
    const targetModule = args.targetModule as string;
    const query = args.query as string;
    return this.bus.queryModule({ targetModule, query });
  }
}

export class FileAccessTool {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  get schema() {
    return {
      name: 'file_access' as const,
      description: '跨模块文件读写操作',
      inputSchema: {
        type: 'object' as const,
        properties: {
          module: { type: 'string' as const, description: '目标模块名称' },
          filePath: { type: 'string' as const, description: '相对于模块根目录的文件路径' },
          operation: { type: 'string' as const, enum: ['read', 'write'] as const, description: '操作类型' },
          content: { type: 'string' as const, description: '写入内容（write 操作时必填）' },
        },
        required: ['module', 'filePath', 'operation'],
      },
    };
  }

  async run(args: Record<string, unknown>, modules: { name: string; path: string }[]): Promise<{ success: boolean; text: string }> {
    const moduleName = args.module as string;
    const filePath = args.filePath as string;
    const operation = args.operation as string;

    const mod = modules.find((m) => m.name === moduleName);
    if (!mod) return { success: false, text: `模块未找到: ${moduleName}` };

    const fullPath = path.join(this.projectRoot, mod.path, filePath);

    if (operation === 'read') {
      if (!await fs.pathExists(fullPath)) {
        return { success: false, text: `文件未找到: ${filePath}` };
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, text: content };
    }

    if (operation === 'write') {
      const content = args.content as string;
      if (content === undefined) {
        return { success: false, text: '写入操作需要 content 参数' };
      }
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, text: `文件写入成功: ${filePath}` };
    }

    return { success: false, text: `未知操作: ${operation}` };
  }
}
