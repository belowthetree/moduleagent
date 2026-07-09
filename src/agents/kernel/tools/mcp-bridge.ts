// ---------------------------------------------------------------------------
// agents/kernel/tools/mcp-bridge.ts — MCP 工具桥接
// 将进程内代理内核连接到现有的 MCP 服务器，提供 module_call、module_query 等工具
// 通过 stdio 启动 MCP 服务器子进程，使用 JSON-RPC 协议通信
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import type { Tool, ToolInputSchema } from '../types.js';

interface McpBridgeConfig {
  workspaceRoot: string;
  moduleName: string;
  graphFilePath?: string;
  backendUrl?: string;
}

export function createMcpBridgeTools(config: McpBridgeConfig): Tool[] {
  const tools: Tool[] = [];

  // ── module_call ──
  const moduleCallSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      targetModule: {
        type: 'string',
        description: '目标模块名称',
      },
      goal: {
        type: 'string',
        description: '要完成的子任务描述',
      },
      background: {
        type: 'string',
        description: '任务的背景信息',
      },
      expectedOutput: {
        type: 'string',
        description: '期望的输出格式',
      },
      constraints: {
        type: 'string',
        description: '任务的约束条件（可选）',
      },
    },
    required: ['targetModule', 'goal', 'background'],
  };

  tools.push({
    name: 'module_call',
    description: '将子任务委托给目标模块的代理执行，等待并接收完整的执行结果。',
    inputSchema: moduleCallSchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await sendMcpRequest(config, 'tools/call', {
        name: 'module_call',
        arguments: input,
      });

      if (!result) {
        return {
          content: JSON.stringify({ error: 'MCP 桥接不可用' }),
          metadata: { error: true, code: 'bridge_unavailable' },
        };
      }

      return {
        content: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { tool: 'module_call', targetModule: input.targetModule as string },
      };
    },
  });

  // ── module_query ──
  const moduleQuerySchema: ToolInputSchema = {
    type: 'object',
    properties: {
      targetModule: {
        type: 'string',
        description: '目标模块名称',
      },
      query: {
        type: 'string',
        description: '要查询的问题',
      },
      background: {
        type: 'string',
        description: '问题的背景信息',
      },
    },
    required: ['targetModule', 'query'],
  };

  tools.push({
    name: 'module_query',
    description: '向目标模块的代理查询信息，获取模块状态、结构等信息。',
    inputSchema: moduleQuerySchema,
    execute: async (input: Record<string, unknown>) => {
      const result = await sendMcpRequest(config, 'tools/call', {
        name: 'module_query',
        arguments: input,
      });

      if (!result) {
        return {
          content: JSON.stringify({ error: 'MCP 桥接不可用' }),
          metadata: { error: true, code: 'bridge_unavailable' },
        };
      }

      return {
        content: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { tool: 'module_query', targetModule: input.targetModule as string },
      };
    },
  });

  // ── module_list ──
  const moduleListSchema: ToolInputSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  tools.push({
    name: 'module_list',
    description: '列出所有可访问的模块及其描述信息。',
    inputSchema: moduleListSchema,
    execute: async (_input: Record<string, unknown>) => {
      const result = await sendMcpRequest(config, 'tools/call', {
        name: 'module_list',
        arguments: {},
      });

      if (!result) {
        return {
          content: JSON.stringify({ error: 'MCP 桥接不可用' }),
          metadata: { error: true, code: 'bridge_unavailable' },
        };
      }

      return {
        content: typeof result === 'string' ? result : JSON.stringify(result),
        metadata: { tool: 'module_list' },
      };
    },
  });

  return tools;
}

// ── MCP 通信基础设施 ──

let mcpProcess: ChildProcess | null = null;
let mcpRequestId = 0;
let mcpReady = false;
let mcpContent: { type: string; text?: string }[] | null = null;

async function sendMcpRequest(
  config: McpBridgeConfig,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!mcpProcess || mcpProcess.killed) {
    await startMcpServer(config);
  }

  if (!mcpProcess || !mcpReady) {
    return null;
  }

  const id = ++mcpRequestId;
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });

  return new Promise<unknown>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 30000);

    mcpContent = null;

    mcpProcess!.stdin!.write(request + '\n');
    mcpProcess!.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'ping',
      params: { id },
    }) + '\n');

    const check = setInterval(() => {
      if (mcpContent) {
        clearInterval(check);
        clearTimeout(timeout);
        const text = mcpContent.map((c) => c.text || '').join('\n');
        try {
          const json = JSON.parse(text);
          resolve(json.content || json.result || text);
        } catch {
          resolve(text);
        }
      }
    }, 100);
  });
}

async function startMcpServer(config: McpBridgeConfig): Promise<void> {
  if (mcpProcess && !mcpProcess.killed) return;

  const serverPath = path.resolve(
    __dirname,
    '../../../../dist/mcp-server.cjs',
  );

  const args = [
    serverPath,
    '--module-name', config.moduleName,
  ];

  if (config.graphFilePath) {
    args.push('--graph-file', config.graphFilePath);
  }

  if (config.backendUrl) {
    args.push('--backend-url', config.backendUrl);
  }

  mcpProcess = spawn('node', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: config.workspaceRoot,
    env: { ...process.env },
    windowsHide: true,
  });

  mcpReady = false;
  mcpContent = null;

  if (mcpProcess.stdout) {
    const rl = createInterface({ input: mcpProcess.stdout });
    rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.result) {
          mcpReady = true;
          if (msg.result.content) {
            mcpContent = msg.result.content;
          }
        }
      } catch {
        // 忽略无法解析的行
      }
    });
  }

  if (mcpProcess.stderr) {
    const rl = createInterface({ input: mcpProcess.stderr });
    rl.on('line', (_line: string) => {
      // stderr 仅用于调试
    });
  }

  mcpProcess.on('exit', () => {
    mcpReady = false;
    mcpProcess = null;
  });

  // 等待连接建立
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!mcpReady) {
        mcpProcess?.kill();
        resolve();
      }
    }, 5000);

    const check = setInterval(() => {
      if (mcpReady || !mcpProcess || mcpProcess.killed) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);
  });
}
