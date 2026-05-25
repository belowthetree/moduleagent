//! Module parser — reads a `module.md` file, extracts YAML frontmatter,
//! and returns a [`ModuleDefinition`].

use std::path::Path;

use super::types::{ModuleDefinition, ModuleFrontmatter, SubModuleRef};

/// Parses `module.md` files into structured [`ModuleDefinition`]s.
pub struct ModuleParser;

impl ModuleParser {
    /// Parse a single `module.md` file.
    pub async fn parse_file(path: &Path) -> Result<ModuleDefinition, crate::util::AppError> {
        let content = tokio::fs::read_to_string(path).await?;
        Self::parse(&content)
    }

    /// Parse `module.md` content (frontmatter + Markdown body).
    pub fn parse(content: &str) -> Result<ModuleDefinition, crate::util::AppError> {
        // Extract YAML frontmatter between `---` delimiters.
        let (yaml_str, body) = if let Some(rest) = content.strip_prefix("---\n") {
            if let Some((yaml, body)) = rest.split_once("\n---") {
                (yaml, body.trim_start())
            } else {
                ("", content)
            }
        } else {
            ("", content)
        };

        let frontmatter: ModuleFrontmatter = if yaml_str.is_empty() {
            ModuleFrontmatter::default()
        } else {
            serde_yaml::from_str(yaml_str).unwrap_or_default()
        };

        // Extract `subModules` from the YAML if present
        let sub_modules: Vec<SubModuleRef> = {
            #[derive(serde::Deserialize, Default)]
            #[allow(dead_code)]
            struct RawFrontmatter {
                #[serde(default)]
                sub_modules: Vec<SubModuleRef>,
                #[serde(default)]
                name: String,
                #[serde(default)]
                description: Option<String>,
            }
            if yaml_str.is_empty() {
                Vec::new()
            } else {
                let raw: RawFrontmatter = serde_yaml::from_str(yaml_str).unwrap_or_default();
                raw.sub_modules
            }
        };

        Ok(ModuleDefinition {
            sub_modules,
            frontmatter,
            content: body.to_string(),
        })
    }
}
