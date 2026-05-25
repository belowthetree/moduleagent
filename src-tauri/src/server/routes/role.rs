//! `/api/roles/*` — role agent management.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::config::loader::ConfigLoader;
use crate::config::schema::RoleConfig;
use crate::server::state::AppState;
use crate::util::{AppError, AppResult};

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await?;
    let roles = config.roles.unwrap_or_default();
    Ok(Json(serde_json::to_value(roles).unwrap_or(json!([]))))
}

pub async fn save(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await?;

    let role: RoleConfig = serde_json::from_value(body)
        .map_err(|e| AppError::Config(format!("invalid role config: {e}")))?;

    let roles = config.roles.get_or_insert_with(Vec::new);
    // Upsert: remove existing with same name, then push
    roles.retain(|r| r.name != role.name);
    roles.push(role);

    loader.save(&config).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let mut config = loader.load().await?;

    if let Some(roles) = config.roles.as_mut() {
        roles.retain(|r| r.name != name);
    }
    // Also stop the role if running
    let _ = state.role_manager.stop(&name).await;

    loader.save(&config).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn start(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let project_root = state.project_root.read().await.clone().unwrap_or_else(|| ".".into());
    let loader = ConfigLoader::new(&project_root);
    let config = loader.load().await?;
    let roles = config.roles.unwrap_or_default();

    let role = roles.iter()
        .find(|r| r.name == name)
        .ok_or_else(|| AppError::Config(format!("role '{name}' not found")))?;

    let session_id = state.role_manager.start(role).await?;
    Ok(Json(json!({ "sessionId": session_id })))
}

pub async fn send(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let text = body["text"].as_str().unwrap_or("");
    let reply = state.role_manager.send(&name, text).await?;
    Ok(Json(json!({ "result": { "reply": reply, "stopReason": "end_turn" } })))
}

pub async fn cancel(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    state.role_manager.cancel(&name).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn stop(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    state.role_manager.stop(&name).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn context_get(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let path = state.config_dir.join("context").join(format!("role-{name}.json"));
    if path.exists() {
        let content = tokio::fs::read_to_string(&path).await?;
        let msgs: Value = serde_json::from_str(&content).unwrap_or(json!([]));
        Ok(Json(msgs))
    } else {
        Ok(Json(json!([])))
    }
}

pub async fn context_clear(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let path = state.config_dir.join("context").join(format!("role-{name}.json"));
    if path.exists() {
        tokio::fs::remove_file(&path).await?;
    }
    Ok(Json(json!({ "ok": true })))
}
