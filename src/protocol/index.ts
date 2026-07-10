// ---------------------------------------------------------------------------
// protocol/index.ts — 协议层公共导出
// ---------------------------------------------------------------------------

export { MCPServer } from './mcp/MCPServer.js';
export type { MCPServerOptions } from './mcp/MCPServer.js';
export { CommunicationBus } from './mcp/CommunicationBus.js';
export type {
  ModuleCallRequest,
  ModuleCallResult,
  ModuleQueryRequest,
  ModuleQueryResult,
} from './mcp/CommunicationBus.js';
