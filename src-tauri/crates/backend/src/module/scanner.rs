//! Module scanner — recursively walks the project directory looking
//! for `module.md` files and parses their frontmatter.

use std::path::Path;

use super::types::ModuleDescriptor;
use super::parser::ModuleParser;

pub struct ScanOptions {
    pub project_root: String,
    pub extra_exclude: Vec<String>,
}

pub async fn scan(options: &ScanOptions) -> Result<Vec<ModuleDescriptor>, crate::util::AppError> {
    let project_root = Path::new(&options.project_root);
    if !project_root.exists() {
        return Err(crate::util::AppError::ProjectRootNotFound(
            options.project_root.clone(),
        ));
    }

    let extra_exclude = options.extra_exclude.clone();
    let project_root_buf = project_root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut modules = Vec::new();
        scan_dir_sync(&project_root_buf, &project_root_buf, &extra_exclude, &mut modules)?;
        Ok::<_, crate::util::AppError>(modules)
    })
    .await
    .map_err(|e| crate::util::AppError::Internal(format!("scan task panicked: {}", e)))?
}

fn scan_dir_sync(
    dir: &Path,
    project_root: &Path,
    extra_exclude: &[String],
    modules: &mut Vec<ModuleDescriptor>,
) -> Result<(), crate::util::AppError> {
    let entries = std::fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        if entry.file_type()?.is_dir() {
            if is_excluded(&name, extra_exclude) {
                continue;
            }
            scan_dir_sync(&path, project_root, extra_exclude, modules)?;
        } else if entry.file_type()?.is_file() && name == "module.md" {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    match ModuleParser::parse(&content) {
                        Ok(definition) => {
                            let root_path = path.parent().unwrap_or(project_root).to_path_buf();
                            let relative_path = pathdiff::diff_paths(&root_path, project_root)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_else(|| ".".to_string());
                            modules.push(ModuleDescriptor {
                                name: definition.frontmatter.name.clone(),
                                root_path,
                                relative_path,
                                module_md_path: path.clone(),
                                definition,
                            });
                        }
                        Err(e) => {
                            tracing::warn!(path = %path.display(), error = %e, "failed to parse module.md");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "failed to read module.md");
                }
            }
        }
    }
    Ok(())
}

fn is_excluded(name: &str, extra_exclude: &[String]) -> bool {
    const BUILTIN: &[&str] = &[
        "node_modules", ".git", ".module-agent", "dist", "target",
        "__pycache__", ".venv", "venv", ".next", ".nuxt", ".cache",
    ];
    if BUILTIN.contains(&name) {
        return true;
    }
    if name.starts_with('.') && name != "." {
        return true;
    }
    extra_exclude.iter().any(|pattern| {
        if let Some(ext) = pattern.strip_prefix("*.") {
            name.ends_with(ext)
        } else {
            name == pattern.as_str()
        }
    })
}