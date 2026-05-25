//! Default values for the configuration schema.

use super::schema::{AgentConfig, ProjectConfig, WorkspaceConfig};

/// Default agent command: `npx -y @zed-industries/claude-code-acp@latest`
pub fn default_agent_config() -> AgentConfig {
    AgentConfig {
        command: "npx".to_string(),
        args: Some(vec![
            "-y".to_string(),
            "@zed-industries/claude-code-acp@latest".to_string(),
        ]),
        fast_model: None,
        normal_model: None,
        auto_switch_model: None,
    }
}

/// Build a minimal default [`ProjectConfig`].
pub fn default_project_config(project_path: &str) -> ProjectConfig {
    ProjectConfig {
        agents: super::schema::AgentsConfig {
            default: default_agent_config(),
            modules: None,
        },
        exclude: vec![
            "node_modules".to_string(),
            ".git".to_string(),
            "dist".to_string(),
            "target".to_string(),
        ],
        project_path: project_path.to_string(),
        summarization: Some(super::schema::SummarizationConfig { enabled: true }),
    }
}

/// Build a minimal default [`WorkspaceConfig`].
pub fn default_workspace_config(project_path: &str) -> WorkspaceConfig {
    let entry = super::schema::ConfigEntry {
        name: "default".to_string(),
        config: default_project_config(project_path),
    };
    WorkspaceConfig {
        configs: vec![entry],
        default_config: "default".to_string(),
        roles: None,
    }
}
