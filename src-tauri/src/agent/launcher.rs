//! Agent launcher — spawns an agent subprocess via [`AcpAgent`] and
//! establishes an ACP [`Client`] connection with auto-approved permissions.
//!
//! The launcher spawns a background tokio task that holds the connection
//! open.  The returned [`LaunchedAgent`] carries a [`ConnectionTo<Agent>`]
//! handle that can be used to create sessions and send prompts.

use std::path::{Path, PathBuf};

use agent_client_protocol::{
    AcpAgent, Client,
    role::acp::Agent,
    schema::{
        InitializeRequest, ProtocolVersion,
        RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
        SelectedPermissionOutcome,
    },
    ConnectionTo,
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use log;

use crate::config::schema::AgentConfig;
use crate::util::{AppError, AppResult};

/// Handle to a running agent — connection + lifecycle control.
#[derive(Debug)]
pub struct LaunchedAgent {
    /// Human-readable agent name (module name).
    pub name: String,
    /// Working directory.
    pub cwd: PathBuf,
    /// Cancel token — dropping this kills the connection.
    pub cancel_token: CancellationToken,
}

/// Spawns agent subprocesses and establishes ACP connections.
pub struct AgentLauncher;

impl AgentLauncher {
    /// Launch an agent subprocess and return a [`ConnectionTo<Agent>`] plus
    /// a [`LaunchedAgent`] lifecycle handle.
    ///
    /// The connection runs in a background tokio task.  Dropping the
    /// [`CancellationToken`] inside [`LaunchedAgent`] will tear down the
    /// connection and kill the subprocess.
    pub async fn launch(
        config: &AgentConfig,
        name: &str,
        cwd: &Path,
    ) -> AppResult<(ConnectionTo<Agent>, LaunchedAgent)> {
        let acp_agent = build_acp_agent(config)?;

        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        let (conn_tx, conn_rx) = oneshot::channel();
        let name_owned = name.to_string();
        let name_for_log = name_owned.clone();
        let cwd_owned = cwd.to_path_buf();

        // ── Spawn the connection in a background task ──────────────
        log::info!("正在启动 Agent [{:?}]...", config);
        tokio::spawn(async move {
            let result = Client
                .builder()
                .name(&name_owned)
                // Auto-approve all permission requests
                .on_receive_request(
                    |req: RequestPermissionRequest, responder: agent_client_protocol::Responder<RequestPermissionResponse>, _cx| async move {
                        if let Some(opt) = req.options.first() {
                            responder.respond(RequestPermissionResponse::new(
                                RequestPermissionOutcome::Selected(
                                    SelectedPermissionOutcome::new(opt.option_id.clone()),
                                ),
                            ))
                        } else {
                            responder.respond(RequestPermissionResponse::new(
                                RequestPermissionOutcome::Cancelled,
                            ))
                        }
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .connect_with(acp_agent, |connection: ConnectionTo<Agent>| async move {
                    // Step 1: Initialize the connection
                    connection
                        .send_request(InitializeRequest::new(ProtocolVersion::V1))
                        .block_task()
                        .await?;

                    log::info!("ACP 连接初始化成功 [{}]", name_owned);

                    // Step 2: Hand the connection handle back to the caller
                    let _ = conn_tx.send(connection);

                    // Step 3: Wait until cancelled (keeps connection alive)
                    cancel_clone.cancelled().await;
                    log::info!("Agent 连接已关闭 [{}]", name_owned);
                    Ok(())
                })
                .await;

            if let Err(ref e) = result {
                log::error!("Agent 连接错误 [{}]: {}", name_for_log, e);
            }
        });

        // Wait for the connection handle (or timeout / error)
        let connection = conn_rx.await.map_err(|_| {
            AppError::Internal(format!(
                "agent '{name}' failed to initialize — process may have exited early"
            ))
        })?;

        Ok((
            connection,
            LaunchedAgent {
                name: name.to_string(),
                cwd: cwd_owned,
                cancel_token: cancel,
            },
        ))
    }
}

/// Build an [`AcpAgent`] from our [`AgentConfig`].
/// On Windows, wraps non-path commands with `cmd.exe /c` to inherit full system PATH.
fn build_acp_agent(config: &AgentConfig) -> AppResult<AcpAgent> {
    let command = &config.command;
    let user_args: Vec<&str> = config.args.as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();

    let args: Vec<&str> = if cfg!(windows) && !command.contains('/') && !command.contains('\\') {
        let mut v = Vec::with_capacity(3 + user_args.len());
        v.push("cmd.exe");
        v.push("/c");
        v.push(command.as_str());
        v.extend(user_args);
        v
    } else {
        let mut v = Vec::with_capacity(1 + user_args.len());
        v.push(command.as_str());
        v.extend(user_args);
        v
    };

    AcpAgent::from_args(args)
        .map_err(|e| AppError::Internal(format!("invalid agent command: {e}")))
}
