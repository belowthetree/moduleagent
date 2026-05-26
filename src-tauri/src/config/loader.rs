//! Config loader — reads, validates, and writes `.module-agent.json`.

use std::path::PathBuf;

use super::schema::WorkspaceConfig;
use super::defaults;

/// Loads and persists the workspace configuration.
pub struct ConfigLoader {
    project_root: PathBuf,
}

impl ConfigLoader {
    /// Create a new loader for the given project root.
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self {
            project_root: project_root.into(),
        }
    }

    /// Path to the config file.
    pub fn config_path(&self) -> PathBuf {
        self.project_root.join(".module-agent.json")
    }

    /// Load the workspace config from disk, or return a sensible default
    /// if the file does not exist.
    pub async fn load(&self) -> Result<WorkspaceConfig, crate::util::AppError> {
        let path = self.config_path();
        if !path.exists() {
            let project_path = self
                .project_root
                .to_str()
                .unwrap_or(".")
                .to_string();
            return Ok(defaults::default_workspace_config(&project_path));
        }

        let content = tokio::fs::read_to_string(&path).await?;
        let config: WorkspaceConfig = serde_json::from_str(&content)
            .map_err(|e| crate::util::AppError::Config(e.to_string()))?;
        log::info!("加载配置文件: {}", path.display());
        Ok(config)
    }

    /// Persist the workspace config to disk (atomic write).
    pub async fn save(&self, config: &WorkspaceConfig) -> Result<(), crate::util::AppError> {
        let path = self.config_path();
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string_pretty(config)?;
        crate::util::fs::atomic_write(&path, json.as_bytes()).await?;
        log::info!("保存配置文件: {}", path.display());
        Ok(())
    }

    /// Get the project path from the config (for resolving relative paths).
    pub fn resolve_path<'a>(
        &self,
        config: &'a WorkspaceConfig,
        name: Option<&str>,
    ) -> Option<&'a str> {
        let entry_name = name.unwrap_or(&config.default_config);
        config
            .configs
            .iter()
            .find(|e| &e.name == entry_name)
            .map(|e| e.config.project_path.as_str())
    }
}
