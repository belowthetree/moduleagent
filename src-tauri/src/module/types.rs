//! Core types for the module graph.

use std::path::PathBuf;

/// Describes a single module discovered during scanning.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModuleDescriptor {
    pub name: String,
    pub root_path: PathBuf,
    pub relative_path: String,
    pub module_md_path: PathBuf,
    pub definition: ModuleDefinition,
}

/// Parsed contents of a `module.md` file.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModuleDefinition {
    #[serde(default)]
    pub sub_modules: Vec<SubModuleRef>,
    pub frontmatter: ModuleFrontmatter,
    /// Raw Markdown body (without frontmatter).
    #[serde(default)]
    pub content: String,
}

/// Reference to a sub-module declared in a parent's `module.md`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubModuleRef {
    pub name: String,
    #[serde(default)]
    pub path: Option<String>,
}

/// Frontmatter extracted from `module.md`.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ModuleFrontmatter {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// A node in the in-memory module tree.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModuleGraphNode {
    pub name: String,
    pub absolute_path: PathBuf,
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub children: Vec<String>,
    #[serde(skip)]
    pub definition: ModuleDefinition,
}
