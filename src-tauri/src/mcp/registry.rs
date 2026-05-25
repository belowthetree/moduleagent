//! MCP server registry — manages the lifecycle of MCP servers
//! attached to agent sessions.
//!
//! Currently each session gets a fresh [`ModuleAgentTools`] instance;
//! the registry tracks nothing at runtime.  This module exists as a
//! hook for future dynamic tool registration.

/// Placeholder registry.
pub struct McpRegistry;

impl McpRegistry {
    pub fn new() -> Self {
        Self
    }
}

impl Default for McpRegistry {
    fn default() -> Self {
        Self::new()
    }
}
