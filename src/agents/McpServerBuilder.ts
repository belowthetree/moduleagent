// ---------------------------------------------------------------------------
// McpServerBuilder.ts — MCP 服务器构建工具
// 提供 writeMcpGraphFile（序列化模块图为 JSON）和 buildMcpServers（构建 MCP server 配置）
// ---------------------------------------------------------------------------

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { McpServerStdio } from '@agentclientprotocol/sdk';
import { defaultLogger } from '../core/Logger.js';

export function writeMcpGraphFile(graph: ModuleGraphType, tempDir?: string): string {
  const nodesObj: Record<string, ModuleGraphNode> = {};
  for (const [name, node] of graph.nodes) {
    nodesObj[name] = node;
  }
  const data = JSON.stringify({ root: graph.root, nodes: nodesObj });
  const filePath = path.join(tempDir || os.tmpdir(), `mcp-graph-${process.pid}.json`);
  fs.writeFileSync(filePath, data, 'utf-8');
  defaultLogger.info(`MCP graph file written: ${filePath}`);
  return filePath;
}

export function buildMcpServers(options: {
  moduleName: string;
  basePath: string;
  backendPort?: number;
  graphFile: string;
  nodeBin?: string;
}): McpServerStdio[] {
  const { moduleName, basePath, backendPort, graphFile, nodeBin = 'node' } = options;

  if (!graphFile) {
    defaultLogger.warn('MCP: graph file not written, skipping mcpServers');
    return [];
  }

  const bundlePath = path.join(basePath, 'dist', 'mcp-server.cjs');
  if (!fs.existsSync(bundlePath)) {
    defaultLogger.warn(`MCP server bundle not found: ${bundlePath}. Run: npm run build:mcp-server`);
    return [];
  }

  const args = [bundlePath, '--graph-file', graphFile, '--module-name', moduleName];
  if (backendPort) {
    args.push('--backend-url', `http://127.0.0.1:${backendPort}`);
  }

  const servers: McpServerStdio[] = [{
    name: 'module-agent',
    command: nodeBin,
    args,
    env: [],
  }];

  defaultLogger.info(`MCP servers for agent (${servers.length}):`);
  for (const s of servers) {
    defaultLogger.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
    defaultLogger.info(`  Tools: module_list, module_call, module_query`);
  }

  return servers;
}
