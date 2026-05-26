//! Default values for the configuration schema.

use super::schema::{AgentConfig, KnowledgeRef, ProjectConfig, RoleAgentConfig, RoleAgentsConfig, RoleConfig, WorkspaceConfig};

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

/// 默认角色：模块生成角色，用于初始化生成模块文件
pub fn default_module_gen_role() -> RoleConfig {
    RoleConfig {
        name: "模块生成角色".to_string(),
        description: "负责根据项目需求生成新模块，扫描源码目录结构并生成 module.md 文件".to_string(),
        visible_module_paths: Vec::new(),
        agents: RoleAgentsConfig {
            default: RoleAgentConfig {
                command: default_agent_config().command,
                args: default_agent_config().args,
            },
        },
        knowledge_refs: Some(vec![KnowledgeRef {
            filename: "MODULE_FORMAT.md".to_string(),
            name: "Module.md 文件规范".to_string(),
        }]),
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
        roles: Some(vec![default_module_gen_role()]),
    }
}
