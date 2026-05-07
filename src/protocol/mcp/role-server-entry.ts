// Standalone MCP server entry point for role agents — spawned by the agent via mcpServers config.
// Communicates with the agent via stdio (MCP protocol).
// No CommunicationBus, no module graph, no backend URL — just file read/write within the workspace.

import { RoleMCPServer } from './RoleMCPServer.js';
import fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let workspace = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) workspace = args[++i]!;
  }

  if (!workspace) {
    process.stderr.write('Missing --workspace argument\n');
    process.exit(1);
  }

  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }

  const server = new RoleMCPServer(workspace);
  await server.start();
  process.stderr.write(`Role MCP server started (workspace: ${workspace})\n`);
}

main().catch((err) => {
  process.stderr.write(`Role MCP server fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
