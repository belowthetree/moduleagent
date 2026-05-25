//! Unified error types for the backend.  Uses [`thiserror`] so every
//! error variant automatically implements `Display` + `std::error::Error`.

use axum::response::{IntoResponse, Response};
use axum::http::StatusCode;

/// Top-level error for the backend.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("agent not found: {0}")]
    AgentNotFound(String),

    #[error("agent already running: {0}")]
    AgentAlreadyRunning(String),

    #[error("module scan failed: {0}")]
    ScanFailed(String),

    #[error("project root not found: {0}")]
    ProjectRootNotFound(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("no project scanned — call /api/project/scan first")]
    NotInitialized,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("ACP protocol error: {0}")]
    Acp(String),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("{0}")]
    Internal(String),
}

/// Convert to an axum HTTP response.  4xx for client errors, 5xx for
/// server / internal errors.
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::AgentNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::AgentAlreadyRunning(_) => (StatusCode::CONFLICT, self.to_string()),
            AppError::NotInitialized => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::Config(_) | AppError::ScanFailed(_) | AppError::ProjectRootNotFound(_) => {
                (StatusCode::BAD_REQUEST, self.to_string())
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = serde_json::json!({ "error": message }).to_string();
        (status, body).into_response()
    }
}

/// Convenience alias used by all route handlers.
pub type AppResult<T> = std::result::Result<T, AppError>;
