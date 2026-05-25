//! Workflow scanner — discovers workflow definitions from the filesystem.

use std::path::PathBuf;

/// A discovered workflow definition.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WorkflowInfo {
    pub name: String,
    pub path: PathBuf,
}

/// Scans for workflow directories.
pub struct WorkflowScanner {
    base_path: PathBuf,
}

impl WorkflowScanner {
    pub fn new(base_path: PathBuf) -> Self {
        Self { base_path }
    }

    /// List all workflow directories.
    pub async fn list(&self) -> Result<Vec<WorkflowInfo>, crate::util::AppError> {
        let mut workflows = Vec::new();
        if self.base_path.exists() {
            let mut entries = tokio::fs::read_dir(&self.base_path).await?;
            while let Some(entry) = entries.next_entry().await? {
                if entry.file_type().await?.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    workflows.push(WorkflowInfo {
                        name,
                        path: entry.path(),
                    });
                }
            }
        }
        Ok(workflows)
    }
}
