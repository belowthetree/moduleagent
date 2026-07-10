// ---------------------------------------------------------------------------
// McpServerBuilder.ts — 模块图文件序列化工具
// ---------------------------------------------------------------------------

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
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


