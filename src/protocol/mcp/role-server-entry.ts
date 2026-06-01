// ---------------------------------------------------------------------------
// protocol/mcp/role-server-entry.ts — 角色 MCP 服务器独立入口点
// 由角色 Agent 通过 mcpServers 配置启动，仅暴露文件读写工具
// ---------------------------------------------------------------------------

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
