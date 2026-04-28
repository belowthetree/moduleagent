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
