//! Module Agent Backend — Rust sidecar server.
//!
//! Replaces the Node.js `server.ts` HTTP/SSE sidecar.  Communicates with the
//! Tauri shell via the `READY:<port>` protocol and serves the same REST + SSE
//! API that the Vue frontend expects.

#![recursion_limit = "256"]

pub mod agent;
pub mod config;
pub mod mcp;
pub mod module;
pub mod role;
pub mod server;
pub mod util;
pub mod workflow;
