//! Serde types mirroring the `.module-agent.json` schema.
//! Equivalent to the Zod schemas in the original TypeScript `config/schema.ts`.

// ── Agent config ──────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fast_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_switch_model: Option<bool>,
}

// ── Project config ────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub agents: AgentsConfig,
    #[serde(default)]
    pub exclude: Vec<String>,
    pub project_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summarization: Option<SummarizationConfig>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsConfig {
    pub default: AgentConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modules: Option<std::collections::HashMap<String, AgentConfig>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizationConfig {
    pub enabled: bool,
}

// ── Config entry (named project config) ───────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub name: String,
    #[serde(flatten)]
    pub config: ProjectConfig,
}

// ── Role config ───────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleConfig {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub visible_module_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge_refs: Option<Vec<KnowledgeRef>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRef {
    pub filename: String,
    pub name: String,
}

// ── Workspace config (top-level `.module-agent.json`) ─────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    pub configs: Vec<ConfigEntry>,
    pub default_config: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roles: Option<Vec<RoleConfig>>,
}

// ── Workflow types ────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepAgentConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_module_paths: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge_refs: Option<Vec<KnowledgeRef>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepInput {
    #[serde(default = "default_from")]
    pub from: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_step: Option<String>,
}

fn default_from() -> String {
    "previous".to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepAcceptance {
    pub criteria: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDefinition {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<StepInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceptance: Option<StepAcceptance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<StepAgentConfig>,
}
