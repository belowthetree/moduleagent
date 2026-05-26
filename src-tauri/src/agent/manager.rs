use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::{
    role::acp::Agent,
    ConnectionTo, SessionMessage,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};
use tracing;

use super::accumulator::StreamAccumulator;
use super::launcher::{AgentLauncher, LaunchedAgent};
use super::prompt::PromptBuilder;
use crate::config::schema::AgentConfig;
use crate::util::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    Idle,
    Streaming,
    Error,
}

struct AgentEntry {
    connection: ConnectionTo<Agent>,
    status: AgentStatus,
    launched: LaunchedAgent,
}

type SendLock = Arc<Mutex<()>>;

pub struct AgentManager {
    agents: RwLock<HashMap<String, AgentEntry>>,
    send_locks: std::sync::Mutex<HashMap<String, SendLock>>,
    app_handle: AppHandle,
    base_path: PathBuf,
    config_dir: PathBuf,
}

impl AgentManager {
    pub fn new(
        app_handle: AppHandle,
        base_path: impl Into<PathBuf>,
        config_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
            send_locks: std::sync::Mutex::new(HashMap::new()),
            app_handle,
            base_path: base_path.into(),
            config_dir: config_dir.into(),
        }
    }

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

    pub async fn send_message(
        &self,
        name: &str,
        text: &str,
        _project_root: &Path,
    ) -> AppResult<StreamAccumulator> {
        let send_lock = self.get_or_create_send_lock(name);
        let _guard = send_lock.lock().await;
        let (connection, cwd) = {
            let agents = self.agents.read().await;
            let entry = agents
                .get(name)
                .ok_or_else(|| AppError::AgentNotFound(name.to_string()))?;
            (entry.connection.clone(), entry.launched.cwd.clone())
        };
        self.set_status(name, AgentStatus::Streaming).await;
        let full_prompt = PromptBuilder::build(name, text, &self.base_path).await;
        let result = self.run_session(name, &connection, &cwd, &full_prompt).await;
        let final_status = match &result {
            Ok(_) => AgentStatus::Idle,
            Err(_) => AgentStatus::Error,
        };
        self.set_status(name, final_status).await;
        result
    }

    pub async fn cancel_agent(&self, name: &str) -> AppResult<()> {
        let agents = self.agents.read().await;
        let _entry = agents
            .get(name)
            .ok_or_else(|| AppError::AgentNotFound(name.to_string()))?;
        self.set_status(name, AgentStatus::Idle).await;
        Ok(())
    }

    pub async fn stop_agent(&self, name: &str) -> AppResult<()> {
        let mut agents = self.agents.write().await;
        if let Some(entry) = agents.remove(name) {
            entry.launched.cancel_token.cancel();
            tracing::info!(agent = %name, "agent stopped");
        }
        Ok(())
    }

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

    pub async fn is_running(&self, name: &str) -> bool {
        self.agents.read().await.contains_key(name)
    }

    async fn run_session(
        &self,
        name: &str,
        connection: &ConnectionTo<Agent>,
        cwd: &Path,
        prompt: &str,
    ) -> AppResult<StreamAccumulator> {
        let mut session = connection
            .build_session(&cwd)
            .block_task()
            .start_session()
            .await
            .map_err(|e| AppError::Acp(format!("failed to create session: {e}")))?;

        tracing::info!(agent = %name, session = %session.session_id(), "session created");

        session
            .send_prompt(prompt)
            .map_err(|e| AppError::Acp(format!("failed to send prompt: {e}")))?;

        let mut acc = StreamAccumulator::new();
        let app_handle = &self.app_handle;

        loop {
            match session.read_update().await {
                Ok(SessionMessage::SessionMessage(dispatch)) => {
                    acc.process_dispatch(dispatch, Some(app_handle)).await?;
                }
                Ok(SessionMessage::StopReason(reason)) => {
                    let reason_str = format!("{reason:?}");
                    acc.finish(reason_str);
                    tracing::info!(agent = %name, stop_reason = ?reason, "session complete");
                    break;
                }
                Ok(_other) => {
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

    fn get_or_create_send_lock(&self, name: &str) -> SendLock {
        let mut locks = self.send_locks.lock().unwrap();
        locks
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

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