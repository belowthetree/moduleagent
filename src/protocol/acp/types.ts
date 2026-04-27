export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface ClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: ClientCapabilities;
  clientInfo: ClientInfo;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
  sessionCapabilities?: {
    close?: Record<string, never>;
    resume?: Record<string, never>;
    list?: Record<string, never>;
  };
}

export interface AgentInfo {
  name: string;
  title: string;
  version: string;
}

export interface AuthMethod {
  methodId: string;
  name?: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
  agentInfo: AgentInfo;
  authMethods?: AuthMethod[];
}

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  type?: 'http';
  url?: string;
  headers?: { name: string; value: string }[];
}

export interface SessionNewParams {
  cwd: string;
  mcpServers?: MCPServerConfig[];
}

export interface SessionNewResult {
  sessionId: string;
}

export type ContentBlock = TextBlock | ImageBlock | AudioBlock | ResourceBlock | ResourceLinkBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  mimeType: string;
  data: string;
}

export interface AudioBlock {
  type: 'audio';
  mimeType: string;
  data: string;
}

export interface ResourceBlock {
  type: 'resource';
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
}

export interface ResourceLinkBlock {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface SessionPromptResult {
  stopReason: StopReason;
}

export interface SessionCancelParams {
  sessionId: string;
}

export interface SessionCloseParams {
  sessionId: string;
}

export interface SessionLoadParams {
  sessionId: string;
  cwd: string;
  mcpServers?: MCPServerConfig[];
}

export interface SessionResumeParams {
  sessionId: string;
  cwd: string;
  mcpServers?: MCPServerConfig[];
}

export interface SessionListParams {
  cwd?: string;
  cursor?: string;
}

export interface SessionListItem {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt: string;
}

export interface SessionListResult {
  sessions: SessionListItem[];
  nextCursor?: string;
}

export type SessionUpdateType =
  | 'user_message_chunk'
  | 'agent_message_chunk'
  | 'thought_message_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'available_commands_update'
  | 'current_mode_update'
  | 'config_option_update'
  | 'session_info_update';

export interface ToolCall {
  toolCallId: string;
  title: string;
  kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  content?: ContentBlock[];
  location?: {
    path: string;
    line?: number;
  };
}

export interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface SessionUpdate {
  sessionUpdate: SessionUpdateType;
  [key: string]: unknown;
}

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

export interface SessionSetModeParams {
  sessionId: string;
  modeId: string;
}

export interface SessionSetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string;
}

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface SessionRequestPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string };
  options: PermissionOption[];
}

export interface PermissionSelectedOutcome {
  outcome: 'selected';
  optionId: string;
}

export interface PermissionCancelledOutcome {
  outcome: 'cancelled';
}

export type PermissionOutcome = PermissionSelectedOutcome | PermissionCancelledOutcome;

export interface SessionRequestPermissionResult {
  outcome: PermissionOutcome;
}

export interface FsReadTextFileParams {
  sessionId: string;
  path: string;
  line?: number;
  limit?: number;
}

export interface FsReadTextFileResult {
  content: string;
}

export interface FsWriteTextFileParams {
  sessionId: string;
  path: string;
  content: string;
}

export interface TerminalCreateParams {
  sessionId: string;
  command: string;
  args?: string[];
  env?: { name: string; value: string }[];
  cwd?: string;
  outputByteLimit?: number;
}

export interface TerminalCreateResult {
  terminalId: string;
}

export interface TerminalOutputParams {
  terminalId: string;
}

export interface TerminalOutputResult {
  output: string;
  truncated: boolean;
  exitStatus?: {
    exitCode: number;
    signal: string | null;
  };
}

export interface TerminalWaitForExitParams {
  terminalId: string;
}

export interface TerminalWaitForExitResult {
  exitCode: number;
  signal: string | null;
}

export interface TerminalKillParams {
  terminalId: string;
}

export interface TerminalReleaseParams {
  terminalId: string;
}
