//! ACP wire types — JSON-RPC 2.0 over NDJSON.
//!
//! Mirrors the structure of `@agentclientprotocol/sdk` to maintain
//! binary compatibility with agent subprocesses (opencode, Claude CLI).

use serde::{Deserialize, Serialize};

// ── JSON-RPC 2.0 primitives ──

/// A JSON-RPC 2.0 request sent by either the Client or the Agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,          // always "2.0"
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// A JSON-RPC 2.0 success response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// A JSON-RPC 2.0 notification (no `id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl JsonRpcNotification {
    pub fn new(method: &str, params: Option<serde_json::Value>) -> Self {
        Self { jsonrpc: "2.0".into(), method: method.into(), params }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

// ── ACP: initialize ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "clientCapabilities")]
    pub client_capabilities: ClientCapabilities,
    #[serde(rename = "clientInfo")]
    pub client_info: ClientInfo,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClientCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs: Option<FsCapabilities>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<TerminalCapabilities>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FsCapabilities {
    #[serde(rename = "readTextFile", default)]
    pub read_text_file: bool,
    #[serde(rename = "writeTextFile", default)]
    pub write_text_file: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TerminalCapabilities {
    #[serde(default)]
    pub create: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub title: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeResponse {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u32,
    #[serde(rename = "agentCapabilities")]
    pub agent_capabilities: AgentCapabilities,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "loadSession")]
    pub load_session: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "promptCapabilities")]
    pub prompt_capabilities: Option<PromptCapabilities>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "mcpCapabilities")]
    pub mcp_capabilities: Option<McpCapabilities>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptCapabilities {
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    #[serde(rename = "embeddedContext")]
    pub embedded_context: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpCapabilities {
    #[serde(default)]
    pub http: bool,
    #[serde(default)]
    pub sse: bool,
}

// ── ACP: session ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSessionParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Option<Vec<McpServerConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSessionResponse {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

// ── ACP: prompt ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub prompt: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "resource_link")]
    ResourceLink { uri: String, name: String, description: Option<String> },
    #[serde(rename = "resource")]
    Resource { resource: ResourceContent },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceContent {
    pub uri: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptResponse {
    #[serde(rename = "stopReason")]
    pub stop_reason: String,
}

// ── ACP: cancel ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

// ── ACP: sessionUpdate (notification from Agent → Client) ──

/// The full `session/update` notification as sent by the Agent.
/// Wraps a `SessionNotification` as its params.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUpdateParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub update: SessionNotification,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "sessionUpdate")]
pub enum SessionNotification {
    #[serde(rename = "agent_message_chunk")]
    MessageChunk {
        content: TextContent,
    },
    #[serde(rename = "agent_thought_chunk")]
    ThoughtChunk {
        content: TextContent,
    },
    #[serde(rename = "tool_call")]
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        title: Option<String>,
        status: Option<String>,
        input: Option<serde_json::Value>,
        output: Option<serde_json::Value>,
    },
    #[serde(rename = "tool_call_result")]
    ToolCallResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        output: Option<serde_json::Value>,
        error: Option<String>,
    },
    #[serde(rename = "usage_update")]
    UsageUpdate {
        cost: Option<UsageCost>,
        size: Option<u64>,
        used: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageCost {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContent {
    #[serde(rename = "type", default = "default_text_type")]
    pub content_type: String,
    pub text: String,
}

fn default_text_type() -> String {
    "text".into()
}

// ── ACP: readTextFile ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadTextFileRequest {
    pub path: String,
    #[serde(default)]
    pub line: Option<u32>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadTextFileResponse {
    pub content: String,
}

// ── ACP: writeTextFile ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteTextFileRequest {
    pub path: String,
    pub content: String,
}

// ── ACP: terminal ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTerminalRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    #[serde(rename = "outputByteLimit")]
    pub output_byte_limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTerminalResponse {
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputRequest {
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutputResponse {
    pub output: String,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "exitStatus")]
    pub exit_status: Option<ExitStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitStatus {
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    #[serde(default)]
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalIdParam {
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
}

// ── ACP: requestPermission ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPermissionParams {
    #[serde(rename = "toolCall")]
    pub tool_call: ToolCallInfo,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallInfo {
    #[serde(rename = "toolCallId")]
    pub tool_call_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOption {
    #[serde(rename = "optionId")]
    pub option_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestPermissionResponse {
    pub outcome: PermissionOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionOutcome {
    pub outcome: String,           // "selected"
    #[serde(rename = "optionId")]
    pub option_id: String,
}

// ── ACP: error ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpError {
    pub code: i64,
    pub message: String,
}

/// Construct an ACP error for protocol-level failures.
impl From<AcpError> for JsonRpcError {
    fn from(e: AcpError) -> Self {
        JsonRpcError { code: e.code, message: e.message }
    }
}

// ── Unified wire message ──

/// Any message that can appear on the wire.
/// Union of JSON-RPC request, response, or notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WireMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}
