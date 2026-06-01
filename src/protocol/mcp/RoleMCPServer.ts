// ---------------------------------------------------------------------------
// protocol/mcp/RoleMCPServer.ts — 角色 Agent MCP 服务器
// 向角色 Agent 暴露 workrole_read_file/workrole_write_file 文件读写工具
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import path from 'path';
import fs from 'fs-extra';

export class RoleMCPServer {
  private server: McpServer;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);

    this.server = new McpServer(
      {
        name: 'role-agent-mcp',
        version: '0.1.0',
      },
      {
        capabilities: { tools: {} },
      },
    );

    this.registerTools();
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, filePath);
    if (!resolved.startsWith(this.workspaceRoot + path.sep) && resolved !== this.workspaceRoot) {
      throw new Error(`Access denied: path "${filePath}" is outside workspace`);
    }
    return resolved;
  }

  private registerTools(): void {
    this.server.registerTool(
      'workrole_read_file',
      {
        description: '读取工作目录中的文件。参数：path 为相对于工作目录的文件路径。',
        inputSchema: z.object({
          path: z.string().describe('相对于工作目录的文件路径'),
        }),
      },
      async (args) => {
        try {
          const fullPath = this.resolvePath(args.path);
          if (!(await fs.pathExists(fullPath))) {
            return { content: [{ type: 'text', text: `文件未找到: ${args.path}` }] };
          }
          const content = await fs.readFile(fullPath, 'utf-8');
          return { content: [{ type: 'text', text: content }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `读取失败: ${(err as Error).message}` }] };
        }
      },
    );

    this.server.registerTool(
      'workrole_write_file',
      {
        description: '写入文件到工作目录。参数：path 为相对于工作目录的文件路径，content 为文件内容。',
        inputSchema: z.object({
          path: z.string().describe('相对于工作目录的文件路径'),
          content: z.string().describe('要写入的文件内容'),
        }),
      },
      async (args) => {
        try {
          const fullPath = this.resolvePath(args.path);
          await fs.ensureDir(path.dirname(fullPath));
          await fs.writeFile(fullPath, args.content, 'utf-8');
          return { content: [{ type: 'text', text: `文件写入成功: ${args.path}` }] };
        } catch (err) {
          return { content: [{ type: 'text', text: `写入失败: ${(err as Error).message}` }] };
        }
      },
    );
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    console.error('[RoleMCPServer] Starting with tools: workrole_read_file, workrole_write_file');
    await this.server.connect(transport);
    console.error('[RoleMCPServer] Connected to stdio transport');
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
