// ---------------------------------------------------------------------------
// agents/kernel/tools/index.ts — 工具工厂和默认工具集
// ---------------------------------------------------------------------------

import { ToolRegistry } from '../ToolRegistry.js';
import type { AgentSandbox } from '../Sandbox.js';
import { createFileReadTool } from './file-read.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createExecuteCommandTool } from './execute-command.js';
import { createSearchTool } from './search.js';
import { createListFilesTool } from './list-files.js';
import { createGitOperationsTool } from './git-operations.js';
import { createMcpBridgeTools } from './mcp-bridge.js';
import type { CrossModuleRouter } from '../../mcp/McpBackend.js';
import type { Tool } from '../types.js';

export function createBuiltinTools(sandbox: AgentSandbox): Tool[] {
  return [
    createFileReadTool(sandbox),
    createFileWriteTool(sandbox),
    createFileEditTool(sandbox),
    // createExecuteCommandTool(sandbox), // 暂时禁用
    createSearchTool(sandbox),
    createListFilesTool(sandbox),
    createGitOperationsTool(sandbox),
  ];
}

export function createKernelToolRegistry(
  sandbox: AgentSandbox,
  crossModuleRouter?: CrossModuleRouter,
  requestingModule?: string,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.registerAll(createBuiltinTools(sandbox));

  if (crossModuleRouter) {
    const mcpTools = createMcpBridgeTools(crossModuleRouter, requestingModule || '');
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
