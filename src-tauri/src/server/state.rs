//! Shared application state, held behind an [`Arc`] and injected into
//! every route handler via axum's `State` extractor.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{RwLock, broadcast};

use crate::agent::AgentManager;
use crate::role::manager::RoleAgentManager;
use crate::workflow::executor::WorkflowExecutor;

/// SSE event sent to all connected frontend clients.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SseEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: serde_json::Value,
}

/// Central application state.
pub struct AppState {
    /// Project root path (set after first `project:scan`).
    pub project_root: RwLock<Option<String>>,

    /// Whether the module graph has been initialised.
    pub initialized: RwLock<bool>,

    /// SSE broadcaster.
    pub sse_tx: broadcast::Sender<SseEvent>,

    /// Config directory path.
    pub config_dir: PathBuf,

    /// Agent lifecycle manager.
    pub agent_manager: Arc<AgentManager>,

    /// Role agent manager.
    pub role_manager: RoleAgentManager,

    /// Workflow executor.
    pub workflow_executor: RwLock<Option<WorkflowExecutor>>,

    /// Workspace root (for role + workflow sandboxes).
    pub workspace_root: PathBuf,
}

impl AppState {
    pub async fn new() -> Result<Arc<Self>, crate::util::AppError> {
        let (sse_tx, _) = broadcast::channel::<SseEvent>(256);

        let cwd = std::env::current_dir()
            .map_err(|e| crate::util::AppError::Io(e))?;
        let config_dir = cwd.join(".module-agent");
        let base_path = config_dir.join("context");
        let workspace_root = config_dir.join("workspace");

        let agent_manager = Arc::new(AgentManager::new(
            sse_tx.clone(),
            base_path,
            config_dir.clone(),
        ));

        let role_manager = RoleAgentManager::new(
            agent_manager.clone(),
            workspace_root.clone(),
        );

        Ok(Arc::new(Self {
            project_root: RwLock::new(None),
            initialized: RwLock::new(false),
            sse_tx,
            config_dir,
            agent_manager,
            role_manager,
            workflow_executor: RwLock::new(None),
            workspace_root,
        }))
    }

    /// Broadcast an SSE event to all connected frontend clients.
    pub fn broadcast(&self, event_type: &str, data: serde_json::Value) {
        let event = SseEvent {
            event_type: event_type.to_string(),
            data,
        };
        let _ = self.sse_tx.send(event);
    }
}
