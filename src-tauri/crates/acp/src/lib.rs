//! ACP (Agent Client Protocol) — Rust implementation.
//!
//! Implements the client side of the ACP protocol: JSON-RPC 2.0 over
//! NDJSON transport, `ClientSideConnection`, and a `Client` trait for
//! handling agent → client method calls (file I/O, terminal, permission).
//!
//! Wire-compatible with `@agentclientprotocol/sdk` (TypeScript).

pub mod client;
pub mod connection;
pub mod transport;
pub mod types;

// Re-export the main types users need
pub use client::{Client, DefaultClient, SessionUpdateFn};
pub use connection::{ClientSideConnection, ConnectionError};
pub use transport::{split_transport, TransportError, TransportReader, TransportWriter};
pub use types::*;
