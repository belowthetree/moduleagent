//! `/api/agent/*` — agent lifecycle management.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::config::schema::AgentConfig;
use crate::server::state::AppState;
use crate::util::{AppError, AppResult};

/// `POST /api/agent/start` — start an agent by module name.
///
/// Body: `{ name: string, command?: string, args?: string[], cwd?: string }`
pub async fn start(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let name = body["name"]
        .as_str()
        .ok_or_else(|| AppError::Config("missing 'name' field".into()))?;

    let cwd_str = body["cwd"]
        .as_str()
        .unwrap_or(".");
    let cwd = std::path::Path::new(cwd_str);

    // Build agent config from body or fall back to defaults
    let command = body["command"]
        .as_str()
        .unwrap_or("npx")
        .to_string();
    let args: Vec<String> = body["args"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| vec!["-y".into(), "@zed-industries/claude-code-acp@latest".into()]);

    let config = AgentConfig {
        command,
        args: Some(args),
        fast_model: None,
        normal_model: None,
        auto_switch_model: None,
    };

    state.agent_manager.start_agent(name, &config, cwd).await?;

    // Broadcast status change via SSE
    state.broadcast(
        "agent-status",
        json!({ "name": name, "status": "idle" }),
    );

    Ok(Json(json!({ "sessionId": name })))
}

/// `POST /api/agent/send` — send a message to a running agent.
///
/// Body: `{ name: string, text: string }`
pub async fn send(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let name = body["name"]
        .as_str()
        .ok_or_else(|| AppError::Config("missing 'name' field".into()))?;
    let text = body["text"]
        .as_str()
        .ok_or_else(|| AppError::Config("missing 'text' field".into()))?;

    let project_root = state
        .project_root
        .read()
        .await
        .clone()
        .unwrap_or_else(|| ".".to_string());
    let project_path = std::path::Path::new(&project_root);

    let result = state.agent_manager.send_message(name, text, project_path).await?;

    Ok(Json(json!({
        "result": {
            "reply": result.reply,
            "thinking": result.thinking,
            "tools": result.tools,
            "timeline": result.timeline,
            "stopReason": result.stop_reason.unwrap_or_else(|| "end_turn".to_string()),
        }
    })))
}

/// `POST /api/agent/cancel` — cancel the current agent turn.
pub async fn cancel(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let name = body["name"]
        .as_str()
        .ok_or_else(|| AppError::Config("missing 'name' field".into()))?;

    state.agent_manager.cancel_agent(name).await?;

    state.broadcast(
        "agent-status",
        json!({ "name": name, "status": "idle" }),
    );

    Ok(Json(json!({ "reply": "", "thinking": "", "tools": "" })))
}

/// `POST /api/agent/stop` — kill the agent subprocess.
pub async fn stop(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let name = body["name"]
        .as_str()
        .ok_or_else(|| AppError::Config("missing 'name' field".into()))?;

    state.agent_manager.stop_agent(name).await?;

    state.broadcast(
        "agent-status",
        json!({ "name": name, "status": "stopped" }),
    );

    Ok(Json(json!({ "ok": true })))
}

/// `GET /api/agent/running` — list agents and their statuses.
pub async fn running(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let agents = state.agent_manager.list_agents().await;
    Ok(Json(serde_json::to_value(agents).unwrap_or(json!([]))))
}
