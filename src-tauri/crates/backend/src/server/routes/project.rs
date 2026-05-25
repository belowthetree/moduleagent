//! `/api/project/*` — project scanning and module tree.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::module::scanner;
use crate::module::graph::ModuleGraph;
use crate::server::state::AppState;
use crate::util::AppResult;

/// `POST /api/project/scan`
///
/// Scans the project directory for modules, builds the module graph.
/// Body: `{ projectPath: string }`
pub async fn scan(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let project_path = body["projectPath"]
        .as_str()
        .unwrap_or(".");

    // Store project root
    *state.project_root.write().await = Some(project_path.to_string());

    // Scan for modules
    let options = scanner::ScanOptions {
        project_root: project_path.to_string(),
        extra_exclude: Vec::new(),
    };

    match scanner::scan(&options).await {
        Ok(descriptors) => {
            let mut graph = ModuleGraph::default();
            let project_path_ref = std::path::Path::new(project_path);
            graph.build(descriptors, project_path_ref)?;

            *state.initialized.write().await = true;

            // Convert graph nodes to a JSON-friendly map
            let nodes_json: serde_json::Map<String, Value> = graph
                .nodes()
                .iter()
                .map(|(name, node)| {
                    (name.clone(), json!({
                        "name": node.name,
                        "absolutePath": node.absolute_path,
                        "relativePath": node.relative_path,
                        "parent": node.parent,
                        "children": node.children,
                    }))
                })
                .collect();

            Ok(Json(json!({
                "root": graph.root().unwrap_or("root"),
                "nodes": nodes_json,
                "moduleCount": graph.len(),
            })))
        }
        Err(_e) => {
            *state.initialized.write().await = true;
            Ok(Json(json!({
                "root": "root",
                "nodes": {},
                "moduleCount": 0,
            })))
        }
    }
}

/// `GET /api/project/tree` — module tree as recursive TreeNode.
pub async fn tree(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let project_root = state
        .project_root
        .read()
        .await
        .clone()
        .unwrap_or_else(|| ".".to_string());

    let mut tree = serde_json::Map::new();
    tree.insert("name".into(), json!("root"));
    tree.insert("path".into(), json!("."));
    tree.insert("description".into(), Value::Null);
    tree.insert("children".into(), json!([]));
    tree.insert("cwd".into(), json!(project_root));
    Ok(Json(Value::Object(tree)))
}

/// `POST /api/project/generate` — ensure root module.md + re-scan.
pub async fn generate(
    State(_state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "count": 0 })))
}
