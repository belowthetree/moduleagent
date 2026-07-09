// ---------------------------------------------------------------------------
// agents/kernel/tools/index.ts — 工具工厂和默认工具集
// ---------------------------------------------------------------------------

import { ToolRegistry } from '../ToolRegistry.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createExecuteCommandTool } from './execute-command.js';
import { createSearchTool } from './search.js';
import { createListFilesTool } from './list-files.js';
import { createGitOperationsTool } from './git-operations.js';
import { createMcpBridgeTools } from './mcp-bridge.js';
import type { Tool } from '../types.js';

export function createBuiltinTools(workspaceRoot: string): Tool[] {
  return [
    createFileReadTool(workspaceRoot),
    createFileWriteTool(workspaceRoot),
    createFileEditTool(workspaceRoot),
    createExecuteCommandTool(workspaceRoot),
    createSearchTool(workspaceRoot),
    createListFilesTool(workspaceRoot),
    createGitOperationsTool(workspaceRoot),
  ];
}

export interface McpBridgeOptions {
  workspaceRoot: string;
  moduleName: string;
  graphFilePath?: string;
  backendUrl?: string;
}

export function createKernelToolRegistry(
  workspaceRoot: string,
  mcpOptions?: McpBridgeOptions,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.registerAll(createBuiltinTools(workspaceRoot));

  if (mcpOptions) {
    const mcpTools = createMcpBridgeTools(mcpOptions);
    registry.registerAll(mcpTools);
  }

  return registry;
}

export {
  createFileReadTool,
  createFileWriteTool,
  createFileEditTool,
  createExecuteCommandTool,
  createSearchTool,
  createListFilesTool,
  createGitOperationsTool,
  createMcpBridgeTools,
};
