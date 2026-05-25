//! `/api/context/*` — conversation context persistence.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::server::state::AppState;
use crate::util::AppResult;

/// `GET /api/context/:name` — load saved conversation context.
pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let path = context_path(&state, &name);
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await?;
        let msgs: Value = serde_json::from_str(&content).unwrap_or(json!([]));
        Ok(Json(msgs))
    } else {
        Ok(Json(json!([])))
    }
}

/// `DELETE /api/context/:name` — clear context for one module.
pub async fn clear(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let path = context_path(&state, &name);
    if path.exists() {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// `DELETE /api/context` — clear all stored contexts.
pub async fn clear_all(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let base = context_dir(&state);
    if base.exists() {
        let mut entries = tokio::fs::read_dir(&base).await?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_file() {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    Ok(Json(json!({ "ok": true })))
}

fn context_dir(state: &AppState) -> PathBuf {
    state.config_dir.join("context")
}

fn context_path(state: &AppState, name: &str) -> PathBuf {
    context_dir(state).join(format!("{name}.json"))
}
