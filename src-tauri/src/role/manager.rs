//! Role agent manager — creates, starts, stops, and sends messages to
//! role-scoped agents.  Delegates to [`AgentManager`] for the actual
//! agent lifecycle.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;
use log;

use crate::agent::AgentManager;
use crate::config::schema::{AgentConfig, RoleConfig};
use crate::util::AppResult;

use super::workspace::RoleWorkspace;

/// Tracks running role agents.
pub struct RoleAgentManager {
    /// Shared agent manager for spawning agents.
    agent_manager: Arc<AgentManager>,
    /// Root path for role workspaces.
    workspace_root: PathBuf,
    /// Running roles: role_name → workspace_dir.
    active_roles: RwLock<HashMap<String, PathBuf>>,
}

impl RoleAgentManager {
    pub fn new(agent_manager: Arc<AgentManager>, workspace_root: PathBuf) -> Self {
        Self {
            agent_manager,
            workspace_root,
            active_roles: RwLock::new(HashMap::new()),
        }
    }

    /// Start a role agent using the given agent config.
    pub async fn start(&self, role: &RoleConfig, agent_config: &AgentConfig) -> AppResult<String> {
        let ws = RoleWorkspace::create(&self.workspace_root, role).await?;
        log::info!("启动角色 Agent [{}]，工作空间: {}", role.name, ws.display());

        self.agent_manager
            .start_agent(&role.name, agent_config, &ws)
            .await?;

        self.active_roles
            .write()
            .await
            .insert(role.name.clone(), ws);

        Ok(role.name.clone())
    }

    /// Send a message to a running role agent.
    pub async fn send(&self, name: &str, text: &str) -> AppResult<String> {
        log::info!("向角色 Agent [{}] 发送消息 ({} 字符)", name, text.chars().count());
        let project_root = std::env::current_dir()
            .unwrap_or_else(|_| ".".into());
        let result = self.agent_manager
            .send_message(name, text, &project_root)
            .await?;
        Ok(result.reply)
    }

    /// Cancel the in-flight operation for a role agent.
    pub async fn cancel(&self, name: &str) -> AppResult<()> {
        log::info!("取消角色 Agent [{}]", name);
        self.agent_manager.cancel_agent(name).await
    }

    /// Stop a role agent and clean up its workspace.
    pub async fn stop(&self, name: &str) -> AppResult<()> {
        log::info!("停止角色 Agent [{}]", name);
        self.agent_manager.stop_agent(name).await?;

        if let Some(ws) = self.active_roles.write().await.remove(name) {
            let _ = RoleWorkspace::remove(&self.workspace_root, name).await;
            drop(ws);
        }
        Ok(())
    }
}
