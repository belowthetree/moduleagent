//! MCP tool definitions using `rmcp`'s `#[tool_router]` macro.
//!
//! Tools provided to every agent session:
//! - `module_call` — send a task to another module agent
//! - `module_query` — query another module for information
//! - `list_modules` — list all available modules

use std::sync::{Arc, Weak};

use rmcp::{
    ErrorData as McpError,
    ServerHandler,
    handler::server::{
        tool::ToolRouter,
        wrapper::Parameters,
    },
    model::*,
    schemars, tool, tool_handler, tool_router,
};
use serde::{Deserialize, Serialize};

use crate::agent::AgentManager;

// ── Tool parameter types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModuleCallParams {
    /// Name of the target module to call.
    pub target_module: String,
    /// The task description to send to the target module.
    pub task: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModuleQueryParams {
    /// Name of the target module to query.
    pub target_module: String,
    /// The query to ask the target module.
    pub query: String,
}

// ── Tool router ───────────────────────────────────────────────────────

/// MCP tools exposed to every agent session.
///
/// Holds a [`Weak`] reference to the shared [`AgentManager`].
#[derive(Clone)]
pub struct ModuleAgentTools {
    agent_manager: Weak<AgentManager>,
    tool_router: ToolRouter<Self>,
}

impl ModuleAgentTools {
    pub fn new(agent_manager: Weak<AgentManager>) -> Self {
        Self {
            agent_manager,
            tool_router: Self::tool_router(),
        }
    }

    fn manager(&self) -> Result<Arc<AgentManager>, McpError> {
        self.agent_manager.upgrade()
            .ok_or_else(|| McpError::internal_error("AgentManager no longer available", None))
    }
}

#[tool_router]
impl ModuleAgentTools {
    /// Call another module agent with a task and return its response.
    #[tool(description = "Send a task to another module agent and get its response. Use this to delegate work to other modules.")]
    async fn module_call(
        &self,
        Parameters(params): Parameters<ModuleCallParams>,
    ) -> Result<CallToolResult, McpError> {
        let mgr = self.manager()?;
        let project_root = std::env::current_dir().unwrap_or_else(|_| ".".into());

        match mgr
            .send_message(&params.target_module, &params.task, &project_root)
            .await
        {
            Ok(result) => Ok(CallToolResult::success(vec![
                Content::text(result.reply)
            ])),
            Err(e) => Ok(CallToolResult::error(vec![
                Content::text(format!("Failed to call module '{}': {e}", params.target_module))
            ])),
        }
    }

    /// Query another module for information.
    #[tool(description = "Query another module for information. The target module will respond with its knowledge about the given query.")]
    async fn module_query(
        &self,
        Parameters(params): Parameters<ModuleQueryParams>,
    ) -> Result<CallToolResult, McpError> {
        let mgr = self.manager()?;
        let project_root = std::env::current_dir().unwrap_or_else(|_| ".".into());
        let prompt = format!("[QUERY] {}", params.query);

        match mgr
            .send_message(&params.target_module, &prompt, &project_root)
            .await
        {
            Ok(result) => Ok(CallToolResult::success(vec![
                Content::text(result.reply)
            ])),
            Err(e) => Ok(CallToolResult::error(vec![
                Content::text(format!("Failed to query module '{}': {e}", params.target_module))
            ])),
        }
    }

    /// List all currently running modules.
    #[tool(description = "List all available module agents and their statuses")]
    async fn list_modules(&self) -> Result<CallToolResult, McpError> {
        let mgr = self.manager()?;
        let agents = mgr.list_agents().await;
        let text = agents
            .iter()
            .map(|a| format!("- {} ({})", a.name, a.status_str()))
            .collect::<Vec<_>>()
            .join("\n");

        Ok(CallToolResult::success(vec![
            Content::text(if text.is_empty() { "No modules running".into() } else { text })
        ]))
    }
}

#[tool_handler]
impl ServerHandler for ModuleAgentTools {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder().enable_tools().build()
        )
        .with_server_info(Implementation::new("module-agent-tools", "0.1.0"))
        .with_protocol_version(ProtocolVersion::V_2024_11_05)
        .with_instructions(
            "Module Agent Tools — provides module_call, module_query, and list_modules tools \
             for inter-module communication."
        )
    }
}

// ── Helper for AgentInfo serialization ────────────────────────────────

impl crate::agent::manager::AgentInfo {
    fn status_str(&self) -> &str {
        match self.status {
            crate::agent::manager::AgentStatus::Idle => "idle",
            crate::agent::manager::AgentStatus::Streaming => "streaming",
            crate::agent::manager::AgentStatus::Error => "error",
        }
    }
}
