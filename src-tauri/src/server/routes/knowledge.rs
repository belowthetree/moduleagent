//! `/api/knowledge/*` — knowledge base file management.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::server::state::AppState;
use crate::util::AppResult;

fn knowledge_dir(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("knowledge")
}

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let dir = knowledge_dir(&state);
    let mut files = Vec::new();
    if dir.exists() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    files.push(json!({ "filename": name }));
                }
            }
        }
    }
    Ok(Json(json!(files)))
}

pub async fn read(
    State(state): State<Arc<AppState>>,
    Path(filename): Path<String>,
) -> AppResult<Json<Value>> {
    let path = knowledge_dir(&state).join(&filename);
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await?;
        Ok(Json(json!({ "filename": filename, "content": content })))
    } else {
        Ok(Json(json!({ "filename": filename, "content": "" })))
    }
}

pub async fn save(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let filename = body["filename"]
        .as_str()
        .unwrap_or("untitled.md");
    let content = body["content"]
        .as_str()
        .unwrap_or("");

    let dir = knowledge_dir(&state);
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(filename);
    crate::util::fs::atomic_write(&path, content.as_bytes()).await?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(filename): Path<String>,
) -> AppResult<Json<Value>> {
    let path = knowledge_dir(&state).join(&filename);
    if path.exists() {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(Json(json!({ "ok": true })))
}
