use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use serde::Serialize;

use crate::agent::AgentManager;
use crate::module::graph::ModuleGraph;
use crate::role::manager::RoleAgentManager;
use crate::workflow::executor::WorkflowExecutor;

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: serde_json::Value,
}

pub struct AppState {
    pub project_root: RwLock<Option<String>>,
    pub initialized: RwLock<bool>,
    pub app_handle: AppHandle,
    pub config_dir: PathBuf,
    pub agent_manager: Arc<AgentManager>,
    pub role_manager: RoleAgentManager,
    pub workflow_executor: RwLock<Option<WorkflowExecutor>>,
    pub workspace_root: PathBuf,
    pub module_graph: RwLock<Option<ModuleGraph>>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Arc<Self>, crate::util::AppError> {
        let cwd = std::env::current_dir()
            .map_err(|e| crate::util::AppError::Io(e))?;
        let config_dir = cwd.join(".module-agent");
        let base_path = config_dir.join("context");
        let workspace_root = config_dir.join("workspace");

        let agent_manager = Arc::new(AgentManager::new(
            app_handle.clone(),
            base_path,
            config_dir.clone(),
        ));

        let role_manager = RoleAgentManager::new(
            agent_manager.clone(),
            workspace_root.clone(),
        );

        log::info!("应用状态初始化完成，配置目录: {}", config_dir.display());

        Ok(Arc::new(Self {
            project_root: RwLock::new(None),
            initialized: RwLock::new(false),
            app_handle,
            config_dir,
            agent_manager,
            role_manager,
            workflow_executor: RwLock::new(None),
            workspace_root,
            module_graph: RwLock::new(None),
        }))
    }

    pub fn broadcast(&self, event_type: &str, data: serde_json::Value) {
        let event = StreamEvent {
            event_type: event_type.to_string(),
            data,
        };
        let _ = self.app_handle.emit("stream", event);
    }
}