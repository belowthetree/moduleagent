//! MCP tool layer — built-in tools (`module_call`, `module_query`),
//! tool registry, and cross-module communication.
//!
//! Uses `rmcp` for tool definition and `agent-client-protocol-rmcp` for
//! bridging into ACP sessions.

pub mod backend;
pub mod registry;
pub mod tools;

pub use tools::ModuleAgentTools;
