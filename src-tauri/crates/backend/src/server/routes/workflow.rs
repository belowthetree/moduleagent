//! `/api/workflows/*` — workflow discovery and execution.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::server::state::AppState;
use crate::util::AppResult;
use crate::workflow::executor::{WorkflowExecutor, WorkflowStep};
use crate::workflow::scanner::WorkflowScanner;

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let scanner = WorkflowScanner::new(state.workspace_root.join("workflows"));
    let workflows = scanner.list().await?;
    Ok(Json(serde_json::to_value(workflows).unwrap_or(json!([]))))
}

pub async fn load(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let _dir = state.workspace_root.join("workflows").join(&name);
    Ok(Json(json!({ "name": name, "steps": [] })))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let name = body["name"].as_str().unwrap_or("new-workflow");
    let dir = state.workspace_root.join("workflows").join(name);
    tokio::fs::create_dir_all(&dir).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> AppResult<Json<Value>> {
    let dir = state.workspace_root.join("workflows").join(&name);
    if dir.exists() {
        tokio::fs::remove_dir_all(&dir).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn step_save(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let dir = state.workspace_root.join("workflows").join(&name);
    tokio::fs::create_dir_all(&dir).await?;
    crate::util::fs::atomic_write(
        &dir.join("STEP.md"),
        body["content"].as_str().unwrap_or("").as_bytes(),
    ).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn step_delete(
    State(state): State<Arc<AppState>>,
    Path((name, step)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let dir = state.workspace_root.join("workflows").join(&name).join(&step);
    if dir.exists() {
        tokio::fs::remove_dir_all(&dir).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn step_add(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let step_name = body["name"].as_str().unwrap_or("new-step");
    let dir = state.workspace_root.join("workflows").join(&name).join(step_name);
    tokio::fs::create_dir_all(&dir).await?;
    let default_step = format!("# {step_name}\n\n");
    crate::util::fs::atomic_write(&dir.join("STEP.md"), default_step.as_bytes()).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn execute(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let user_input = body["input"].as_str().unwrap_or("");

    let steps = vec![WorkflowStep {
        name: name.clone(),
        agent_name: name.clone(),
        input_from: "user".to_string(),
    }];

    let executor = WorkflowExecutor::new(state.agent_manager.clone());
    *state.workflow_executor.write().await = Some(executor);
    // We need to get it back (can't move out of RwLock)
    let result = if let Some(ref exec) = *state.workflow_executor.read().await {
        exec.execute(&steps, user_input).await?
    } else {
        String::new()
    };

    Ok(Json(json!({ "sessionId": name, "result": result })))
}

pub async fn cancel(
    State(state): State<Arc<AppState>>,
    Path(_name): Path<String>,
) -> AppResult<Json<Value>> {
    if let Some(ref exec) = *state.workflow_executor.read().await {
        exec.cancel();
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    Path(_name): Path<String>,
) -> AppResult<Json<Value>> {
    let has_executor = state.workflow_executor.read().await.is_some();
    Ok(Json(json!({ "status": if has_executor { "running" } else { "idle" } })))
}
