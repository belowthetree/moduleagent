//! Entry point for the Module Agent sidecar binary.
//!
//! 1. Reads `SIDECAR_PORT` env var (or picks a random port).
//! 2. Builds the axum router with all REST + SSE routes.
//! 3. Binds to `127.0.0.1:<port>` and prints `READY:<port>` so Tauri can
//!    discover the sidecar.

use std::net::SocketAddr;

use module_agent_backend::server;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Logging ──────────────────────────────────────────────────────
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    tracing::info!("module-agent-backend starting");

    // ── Port selection ───────────────────────────────────────────────
    let port: u16 = std::env::var("SIDECAR_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // ── Build application state ──────────────────────────────────────
    let state = server::state::AppState::new().await?;

    // ── Build router ─────────────────────────────────────────────────
    let app = server::app::build_router(state);

    // ── Bind & signal readiness ──────────────────────────────────────
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let actual_port = listener.local_addr()?.port();

    // Tauri sidecar protocol: first line of stdout MUST be READY:<port>
    println!("READY:{actual_port}");
    tracing::info!(port = actual_port, "sidecar ready");

    axum::serve(listener, app).await?;

    Ok(())
}
