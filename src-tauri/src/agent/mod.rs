//! Agent lifecycle management — spawn, send, stream, cancel, stop.
//!
//! Built on `agent_client_protocol`'s `Client` role + `AcpAgent` for
//! spawning agent subprocesses, session management, and prompt/response.

pub mod accumulator;
pub mod launcher;
pub mod manager;
pub mod prompt;

pub use launcher::{AgentLauncher, LaunchedAgent};
pub use manager::AgentManager;
pub use accumulator::StreamAccumulator;
pub use prompt::PromptBuilder;
