//! Agent manager — central registry for all running agents.
//!
//! Manages:
//! - Agent lifecycle (start / send / cancel / stop)
//! - Per-agent send locks (serialises sends for a single agent)
//! - Status tracking (idle / streaming / error)
//! - Stream accumulation and SSE broadcast

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::{
    role::acp::Agent,
    ConnectionTo, SessionMessage,
};
use tokio::sync::{broadcast, Mutex, RwLock};
use tracing;

use super::accumulator::StreamAccumulator;
use super::launcher::{AgentLauncher, LaunchedAgent};
use super::prompt::PromptBuilder;
use crate::config::schema::AgentConfig;
use crate::server::state::SseEvent;
use crate::util::{AppError, AppResult};

// ── Types ────────────────────────────────────────────────────────────

/// Status of a single agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    Idle,
    Streaming,
    Error,
}

/// Entry in the agent registry.
struct AgentEntry {
    connection: ConnectionTo<Agent>,
    status: AgentStatus,
    launched: LaunchedAgent,
}

/// Per-module send lock (serialises sends).
type SendLock = Arc<Mutex<()>>;

// ── AgentManager ──────────────────────────────────────────────────────

/// Central agent registry and lifecycle manager.
///
/// All fields are behind locks so the manager is `Send + Sync` and can be
/// shared freely across axum handlers and background tasks.
pub struct AgentManager {
    /// Running agents keyed by module name.
    agents: RwLock<HashMap<String, AgentEntry>>,

    /// Per-agent send locks — ensures only one send is in-flight per agent.
    send_locks: std::sync::Mutex<HashMap<String, SendLock>>,

    /// SSE broadcaster reference (from AppState).
    sse_tx: broadcast::Sender<SseEvent>,

    /// Base path for context storage.
    base_path: PathBuf,

    /// Config directory path.
    config_dir: PathBuf,
}

impl AgentManager {
    /// Create a new [`AgentManager`].
    pub fn new(
        sse_tx: broadcast::Sender<SseEvent>,
        base_path: impl Into<PathBuf>,
        config_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            send_locks: std::sync::Mutex::new(HashMap::new()),
            sse_tx,
            base_path: base_path.into(),
            config_dir: config_dir.into(),
        }
    }

    // ── Public API ──────────────────────────────────────────────────

    /// Start an agent for the given module name.
    ///
    /// Returns an error if the agent is already running.
    pub async fn start_agent(
        &self,
        name: &str,
        config: &AgentConfig,
        cwd: &Path,
    ) -> AppResult<()> {
        let mut agents = self.agents.write().await;

        if agents.contains_key(name) {
            return Err(AppError::AgentAlreadyRunning(name.to_string()));
        }

        let (connection, launched) = AgentLauncher::launch(config, name, cwd).await?;

        agents.insert(
            name.to_string(),
            AgentEntry {
                connection,
                status: AgentStatus::Idle,
                launched,
            },
        );

        tracing::info!(agent = %name, cwd = %cwd.display(), "agent started");
        Ok(())
    }

    /// Send a message to a running agent and collect the response.
    ///
    /// This is the main entry point for `POST /api/agent/send`.  It:
    /// 1. Acquires the per-agent send lock
    /// 2. Creates an ACP session
    /// 3. Sends the prompt
    /// 4. Streams updates into a [`StreamAccumulator`]
    /// 5. Returns the accumulated result
    pub async fn send_message(
        &self,
        name: &str,
        text: &str,
        _project_root: &Path,
    ) -> AppResult<StreamAccumulator> {
        // ── Acquire send lock for this agent ────────────────────
        let send_lock = self.get_or_create_send_lock(name);
        let _guard = send_lock.lock().await;

        // ── Look up the agent ───────────────────────────────────
        let (connection, cwd) = {
            let agents = self.agents.read().await;
            let entry = agents
                .get(name)
                .ok_or_else(|| AppError::AgentNotFound(name.to_string()))?;
            (entry.connection.clone(), entry.launched.cwd.clone())
        };
        // Read lock released here; send lock ensures exclusive access

        // ── Set status to streaming ─────────────────────────────
        self.set_status(name, AgentStatus::Streaming).await;

        // ── Build the full prompt ───────────────────────────────
        let full_prompt = PromptBuilder::build(name, text, &self.base_path).await;

        // ── Create session + send prompt ────────────────────────
        let result = self.run_session(name, &connection, &cwd, &full_prompt).await;

        // ── Restore status ──────────────────────────────────────
        let final_status = match &result {
            Ok(_) => AgentStatus::Idle,
            Err(_) => AgentStatus::Error,
        };
        self.set_status(name, final_status).await;

        result
    }

    /// Cancel the current in-flight send for an agent.
    pub async fn cancel_agent(&self, name: &str) -> AppResult<()> {
        let agents = self.agents.read().await;
        let _entry = agents
            .get(name)
            .ok_or_else(|| AppError::AgentNotFound(name.to_string()))?;
        // The send lock naturally serialises — cancelling just sets status.
        // A full cancel would need to abort the session, which we'll
        // implement with CancellationToken later.
        self.set_status(name, AgentStatus::Idle).await;
        Ok(())
    }

    /// Stop (kill) an agent subprocess.
    pub async fn stop_agent(&self, name: &str) -> AppResult<()> {
        let mut agents = self.agents.write().await;
        if let Some(entry) = agents.remove(name) {
            // Trigger the cancel token → connection closes → subprocess dies
            entry.launched.cancel_token.cancel();
            tracing::info!(agent = %name, "agent stopped");
        }
        Ok(())
    }

    /// List all running agents with their statuses.
    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        let agents = self.agents.read().await;
        agents
            .iter()
            .map(|(name, entry)| AgentInfo {
                name: name.clone(),
                status: entry.status.clone(),
            })
            .collect()
    }

    /// Check if an agent is running.
    pub async fn is_running(&self, name: &str) -> bool {
        self.agents.read().await.contains_key(name)
    }

    // ── Internal helpers ────────────────────────────────────────────

    /// Run a full prompt session: create session → send → read updates.
    async fn run_session(
        &self,
        name: &str,
        connection: &ConnectionTo<Agent>,
        cwd: &Path,
        prompt: &str,
    ) -> AppResult<StreamAccumulator> {
        // Create a new session
        let mut session = connection
            .build_session(&cwd)
            .block_task()
            .start_session()
            .await
            .map_err(|e| AppError::Acp(format!("failed to create session: {e}")))?;

        tracing::info!(agent = %name, session = %session.session_id(), "session created");

        // Send the prompt
        session
            .send_prompt(prompt)
            .map_err(|e| AppError::Acp(format!("failed to send prompt: {e}")))?;

        // Read updates in a loop
        let mut acc = StreamAccumulator::new();
        let sse_tx = &self.sse_tx;

        loop {
            match session.read_update().await {
                Ok(SessionMessage::SessionMessage(dispatch)) => {
                    acc.process_dispatch(dispatch, Some(sse_tx)).await?;
                }
                Ok(SessionMessage::StopReason(reason)) => {
                    let reason_str = format!("{reason:?}");
                    acc.finish(reason_str);
                    tracing::info!(agent = %name, stop_reason = ?reason, "session complete");
                    break;
                }
                Ok(_other) => {
                    // Non-exhaustive enum — ignore unknown variants
                    tracing::debug!(agent = %name, "unknown session message");
                }
                Err(e) => {
                    tracing::error!(agent = %name, error = %e, "session read error");
                    return Err(AppError::Acp(format!("session read error: {e}")));
                }
            }
        }

        Ok(acc)
    }

    /// Get or create a send lock for an agent.
    fn get_or_create_send_lock(&self, name: &str) -> SendLock {
        let mut locks = self.send_locks.lock().unwrap();
        locks
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Update an agent's status.
    async fn set_status(&self, name: &str, status: AgentStatus) {
        let mut agents = self.agents.write().await;
        if let Some(entry) = agents.get_mut(name) {
            let old_status = std::mem::replace(&mut entry.status, status.clone());
            if old_status != status {
                tracing::debug!(agent = %name, ?old_status, ?status, "agent status change");
            }
        }
    }
}

// ── Public types ──────────────────────────────────────────────────────

/// Summary info for one agent (used by `GET /api/agent/running`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub status: AgentStatus,
}

impl serde::Serialize for AgentStatus {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            AgentStatus::Idle => s.serialize_str("idle"),
            AgentStatus::Streaming => s.serialize_str("streaming"),
            AgentStatus::Error => s.serialize_str("error"),
        }
    }
}
