//! Axum router builder.  Registers every REST + SSE route that the
//! Vue frontend expects.  Route signatures mirror the original
//! `server.ts` exactly so the frontend needs zero changes.

use std::sync::Arc;

use axum::Router;
use axum::routing::{delete, get, post};

use super::state::AppState;

/// Build the complete axum router with all API routes mounted.
pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        // ── SSE stream ────────────────────────────────────────────
        .route("/api/stream", get(super::sse::stream_handler))
        // ── Project ───────────────────────────────────────────────
        .route("/api/project/scan", post(super::routes::project::scan))
        .route("/api/project/tree", get(super::routes::project::tree))
        .route("/api/project/generate", post(super::routes::project::generate))
        // ── Agent ─────────────────────────────────────────────────
        .route("/api/agent/start", post(super::routes::agent::start))
        .route("/api/agent/send", post(super::routes::agent::send))
        .route("/api/agent/cancel", post(super::routes::agent::cancel))
        .route("/api/agent/stop", post(super::routes::agent::stop))
        .route("/api/agent/running", get(super::routes::agent::running))
        // ── Config ────────────────────────────────────────────────
        .route("/api/config/get", get(super::routes::config::get))
        .route("/api/config/save", post(super::routes::config::save))
        // ── Context ───────────────────────────────────────────────
        .route("/api/context/{name}", get(super::routes::context::get))
        .route("/api/context/{name}", delete(super::routes::context::clear))
        .route("/api/context", delete(super::routes::context::clear_all))
        // ── Roles ─────────────────────────────────────────────────
        .route("/api/roles", get(super::routes::role::list))
        .route("/api/roles", post(super::routes::role::save))
        .route("/api/roles/{name}", delete(super::routes::role::delete))
        .route("/api/roles/{name}/start", post(super::routes::role::start))
        .route("/api/roles/{name}/send", post(super::routes::role::send))
        .route("/api/roles/{name}/cancel", post(super::routes::role::cancel))
        .route("/api/roles/{name}/stop", post(super::routes::role::stop))
        .route("/api/roles/{name}/context", get(super::routes::role::context_get))
        .route("/api/roles/{name}/context", delete(super::routes::role::context_clear))
        // ── Knowledge ─────────────────────────────────────────────
        .route("/api/knowledge", get(super::routes::knowledge::list))
        .route("/api/knowledge/{filename}", get(super::routes::knowledge::read))
        .route("/api/knowledge", post(super::routes::knowledge::save))
        .route("/api/knowledge/{filename}", delete(super::routes::knowledge::delete))
        // ── Workflows ─────────────────────────────────────────────
        .route("/api/workflows", get(super::routes::workflow::list))
        .route("/api/workflows/{name}", get(super::routes::workflow::load))
        .route("/api/workflows", post(super::routes::workflow::create))
        .route("/api/workflows/{name}", delete(super::routes::workflow::delete))
        .route("/api/workflows/{name}/steps", post(super::routes::workflow::step_save))
        .route("/api/workflows/{name}/steps/{step}", delete(super::routes::workflow::step_delete))
        .route("/api/workflows/{name}/steps/add", post(super::routes::workflow::step_add))
        .route("/api/workflows/{name}/execute", post(super::routes::workflow::execute))
        .route("/api/workflows/{name}/cancel", post(super::routes::workflow::cancel))
        .route("/api/workflows/{name}/status", get(super::routes::workflow::status))
        // ── Migrate (stubs) ───────────────────────────────────────
        .route("/api/migrate/check", post(super::routes::migrate::check))
        .route("/api/migrate/data", post(super::routes::migrate::data))
        // ── Shared state ──────────────────────────────────────────
        .with_state(state)
}
