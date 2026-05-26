use thiserror::Error;

#[derive(Debug, Error)]
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

    #[error("no project scanned")]
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

pub type AppResult<T> = std::result::Result<T, AppError>;