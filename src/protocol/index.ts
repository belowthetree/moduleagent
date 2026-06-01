// ---------------------------------------------------------------------------
// protocol/index.ts — 协议层公共导出
// 统一导出 ACP 和 MCP 模块的公共类型和工厂函数
// ---------------------------------------------------------------------------

export { createAgentConnection } from './acp/connection.js';
export type { AgentProcessOptions, AgentConnection } from './acp/connection.js';
export { FsHandler } from './acp/handlers/fs.js';
export { TerminalHandler } from './acp/handlers/terminal.js';

export { MCPServer } from './mcp/MCPServer.js';
export type { MCPServerOptions } from './mcp/MCPServer.js';
export { CommunicationBus } from './mcp/CommunicationBus.js';
export type {
  ModuleCallRequest,
  ModuleCallResult,
  ModuleQueryRequest,
  ModuleQueryResult,
} from './mcp/CommunicationBus.js';

export type { ClientSideConnection, Client, SessionNotification } from '@agentclientprotocol/sdk';
export type { PromptResponse, StopReason, McpServer, ContentBlock, TextContent } from '@agentclientprotocol/sdk';
