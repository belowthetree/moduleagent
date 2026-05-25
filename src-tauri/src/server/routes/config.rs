//! `/api/config/*` — workspace configuration.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::config::loader::ConfigLoader;
use crate::server::state::AppState;
use crate::util::AppResult;

/// `GET /api/config/get` — read the current workspace config.
pub async fn get(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let project_root = state
        .project_root
        .read()
        .await
        .clone()
        .unwrap_or_else(|| ".".to_string());

    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await?;

    // Return the first config entry's data (matching the original API shape)
    let entry = config.configs.first();

    Ok(Json(json!({
        "command": entry.as_ref().map(|e| &e.config.agents.default.command).unwrap_or(&String::new()),
        "args": entry.as_ref().and_then(|e| e.config.agents.default.args.as_ref()).cloned().unwrap_or_default(),
        "projectPath": entry.as_ref().map(|e| e.config.project_path.as_str()).unwrap_or(""),
        "summarizationEnabled": entry.as_ref()
            .and_then(|e| e.config.summarization.as_ref())
            .map(|s| s.enabled)
            .unwrap_or(true),
    })))
}

/// `POST /api/config/save` — persist workspace config changes.
pub async fn save(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let project_root = state
        .project_root
        .read()
        .await
        .clone()
        .unwrap_or_else(|| ".".to_string());

    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await?;

    // Merge fields from the request body into the first config entry
    if let Some(entry) = config.configs.first_mut() {
        if let Some(cmd) = body["command"].as_str() {
            entry.config.agents.default.command = cmd.to_string();
        }
        if let Some(args) = body["args"].as_array() {
            entry.config.agents.default.args = Some(
                args.iter().filter_map(|v| v.as_str().map(String::from)).collect()
            );
        }
        if let Some(pp) = body["projectPath"].as_str() {
            entry.config.project_path = pp.to_string();
        }
    }

    loader.save(&config).await?;
    Ok(Json(json!({ "ok": true })))
}
