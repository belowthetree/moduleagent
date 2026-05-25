//! `/api/migrate/*` — data migration stubs.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::server::state::AppState;
use crate::util::AppResult;

pub async fn check(State(_state): State<Arc<AppState>>) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "needed": [], "streamNeeded": false })))
}

pub async fn data(
    State(_state): State<Arc<AppState>>,
    Json(_body): Json<Value>,
) -> AppResult<Json<Value>> {
    Ok(Json(json!({})))
}
