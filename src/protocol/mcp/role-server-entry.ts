// 独立的角色 Agent MCP 服务器入口点——由 Agent 通过 mcpServers 配置启动。
// 通过 stdio（MCP 协议）与 Agent 通信。
// 没有 CommunicationBus、模块图和后端 URL——仅在工作区内读写文件。

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
