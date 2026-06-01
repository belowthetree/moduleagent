// ---------------------------------------------------------------------------
// protocol/mcp/server-entry.ts — MCP 服务器独立入口点
// 由 Agent 通过 mcpServers 配置启动，通过 stdio 通信，
// 通过 HTTP 反向通道实现跨模块调用
// ---------------------------------------------------------------------------

import { CommunicationBus } from './CommunicationBus.js';
import { MCPServer } from './MCPServer.js';
import type { ModuleGraph } from '../../types/module.js';
import fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let graphFile = '';
  let backendUrl = '';
  let moduleName = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--graph-file' && args[i + 1]) graphFile = args[++i]!;
    else if (args[i] === '--backend-url' && args[i + 1]) backendUrl = args[++i]!;
    else if (args[i] === '--module-name' && args[i + 1]) moduleName = args[++i]!;
  }

  if (!graphFile) {
    process.stderr.write('Missing --graph-file argument\n');
    process.exit(1);
  }

  let graph: ModuleGraph;
  try {
    const raw = JSON.parse(fs.readFileSync(graphFile, 'utf-8')) as { root: string; nodes: Record<string, unknown> };
    graph = {
      root: raw.root,
      nodes: new Map(Object.entries(raw.nodes)),
    } as ModuleGraph;
  } catch (err) {
    process.stderr.write(`Failed to read graph file: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const bus = new CommunicationBus();
  bus.setModuleGraph(graph);
  bus.setGraphFile(graphFile);

  if (backendUrl) {
    bus.onMessage(async (message) => {
      try {
        const resp = await fetch(backendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        });
        return await resp.json() as { success: boolean; result?: string; answer?: string; error?: string };
      } catch (err) {
        return { success: false, error: `Backend unreachable: ${(err as Error).message}` };
      }
    });
  }

  const server = new MCPServer(bus, {
    name: 'module-agent-mcp',
    version: '0.1.0',
    moduleName,
  });

  await server.start();
  process.stderr.write(`MCP server started (modules: ${graph.nodes.size})\n`);
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
