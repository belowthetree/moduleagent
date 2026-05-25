//! Role workspace — creates isolated copies of visible module directories
//! for role agents to operate in.

use std::path::{Path, PathBuf};

use crate::config::schema::RoleConfig;
use crate::util::AppResult;

/// Manages isolated workspace directories for role agents.
pub struct RoleWorkspace;

impl RoleWorkspace {
    /// Create (or reuse) a workspace directory for a role.
    pub async fn create(
        workspace_root: &Path,
        role: &RoleConfig,
    ) -> AppResult<PathBuf> {
        let ws_dir = workspace_root.join("workrole").join(&role.name);
        tokio::fs::create_dir_all(&ws_dir).await?;
        Ok(ws_dir)
    }

    /// Remove a role's workspace.
    pub async fn remove(workspace_root: &Path, role_name: &str) -> AppResult<()> {
        let ws_dir = workspace_root.join("workrole").join(role_name);
        if ws_dir.exists() {
            tokio::fs::remove_dir_all(&ws_dir).await?;
        }
        Ok(())
    }
}
