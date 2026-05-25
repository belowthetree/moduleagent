//! MCP backend — handles cross-module MCP routing.
//!
//! In the original TypeScript this was an HTTP server that proxied
//! inter-module requests.  In the Rust version, inter-module calls go
//! through [`AgentManager::send_message`] directly (in-process), so
//! this module is just a placeholder for future HTTP-based routing if
//! we ever need to communicate with external MCP servers.

/// Stub — inter-module calls currently go through AgentManager directly.
pub struct McpBackend;

impl McpBackend {
    /// Create a new (empty) backend.
    pub fn new() -> Self {
        Self
    }
}

impl Default for McpBackend {
    fn default() -> Self {
        Self::new()
    }
}
