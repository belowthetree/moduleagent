// Standalone MCP server entry point — spawned by the agent via mcpServers config.
// Communicates with the agent via stdio (MCP protocol).
// Communicates with the electron process via HTTP back-channel for cross-module calls.

import { CommunicationBus } from './CommunicationBus.js';
import { MCPServer } from './MCPServer.js';
import type { ModuleGraph } from '../../types/module.js';
import fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let graphFile = '';
  let backendUrl = '';
  let moduleName = '';
  let workspaceRoot = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--graph-file' && args[i + 1]) graphFile = args[++i]!;
    else if (args[i] === '--backend-url' && args[i + 1]) backendUrl = args[++i]!;
    else if (args[i] === '--module-name' && args[i + 1]) moduleName = args[++i]!;
    else if (args[i] === '--workspace-root' && args[i + 1]) workspaceRoot = args[++i]!;
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
    projectRoot: process.cwd(),
    workspaceRoot: workspaceRoot || undefined,
    moduleName,
  });

  await server.start();
  process.stderr.write(`MCP server started (modules: ${graph.nodes.size})\n`);
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
