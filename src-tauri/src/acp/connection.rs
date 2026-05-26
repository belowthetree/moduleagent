//! ClientSideConnection — the client's view of an ACP session.
//!
//! Manages the JSON-RPC 2.0 request/response dispatch and provides
//! the public API: `initialize`, `new_session`, `prompt`, `cancel`.

use crate::acp::client::{Client, DefaultClient};
use crate::acp::transport::{split_transport, TransportError, TransportReader, TransportWriter};
use crate::acp::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

/// Internal command sent to the dispatch loop.
enum DispatchCmd {
    SendRequest {
        method: String,
        params: Option<serde_json::Value>,
        reply: oneshot::Sender<Result<serde_json::Value, AcpError>>,
    },
    SendNotification {
        method: String,
        params: Option<serde_json::Value>,
    },
    Shutdown,
}

/// The ACP client-side connection.
///
/// Spawns an internal dispatch loop with a reader task (reads agent
/// responses/requests) and a command loop (sends client requests).
pub struct ClientSideConnection {
    cmd_tx: mpsc::Sender<DispatchCmd>,
}

impl ClientSideConnection {
    /// Build a new connection by spawning the agent subprocess and
    /// starting the dispatch loop.
    pub async fn launch(
        command: &str,
        args: &[&str],
        cwd: &str,
        client: Arc<DefaultClient>,
    ) -> Result<Self, ConnectionError> {
        // Normalize paths on Windows
        let cwd_normalized = cwd.replace('\\', "/");

        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args);
        cmd.current_dir(cwd_normalized);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| ConnectionError::Spawn(e.to_string()))?;
        log::info!("启动 Agent 子进程: {} {} (pid: {:?})", command, args.join(" "), child.id());

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ConnectionError::Spawn("no stdout".into()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ConnectionError::Spawn("no stdin".into()))?;

        // Forward stderr to tracing
        if let Some(stderr) = child.stderr {
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stderr);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match tokio::io::AsyncBufReadExt::read_line(&mut reader, &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = buf.trim();
                            if !line.is_empty() {
                                log::debug!("[agent stderr] {}", line);
                            }
                        }
                    }
                }
            });
        }

        let (mut reader, mut writer) = split_transport(stdout, stdin);
        let (cmd_tx, cmd_rx) = mpsc::channel(256);

        // Spawn the combined dispatch loop
        let dispatch_client = client.clone();
        tokio::spawn(async move {
            dispatch_loop(&mut reader, &mut writer, cmd_rx, dispatch_client).await;
        });

        Ok(Self { cmd_tx })
    }

    // ── Public API ──

    /// Send `initialize` and return the agent's capabilities.
    pub async fn initialize(&self, params: &InitializeParams) -> Result<InitializeResponse, AcpError> {
        let result = self
            .send_request("initialize", Some(serde_json::to_value(params).unwrap()))
            .await?;
        serde_json::from_value(result).map_err(|e| AcpError {
            code: -32700,
            message: format!("invalid initialize response: {}", e),
        })
    }

    /// Create a new session for an agent.
    pub async fn new_session(&self, params: &NewSessionParams) -> Result<NewSessionResponse, AcpError> {
        let result = self
            .send_request("session/new", Some(serde_json::to_value(params).unwrap()))
            .await?;
        serde_json::from_value(result).map_err(|e| AcpError {
            code: -32700,
            message: format!("invalid newSession response: {}", e),
        })
    }

    /// Send a prompt to an agent session and return the stop reason.
    pub async fn prompt(&self, params: &PromptParams) -> Result<PromptResponse, AcpError> {
        let result = self
            .send_request("session/prompt", Some(serde_json::to_value(params).unwrap()))
            .await?;
        serde_json::from_value(result).map_err(|e| AcpError {
            code: -32700,
            message: format!("invalid prompt response: {}", e),
        })
    }

    /// Send a cancel notification (fire-and-forget).
    pub async fn cancel(&self, params: &CancelParams) -> Result<(), AcpError> {
        self.send_notification("session/cancel", Some(serde_json::to_value(params).unwrap()))
            .await
    }

    // ── Internal ──

    async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, AcpError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(DispatchCmd::SendRequest {
                method: method.into(),
                params,
                reply: tx,
            })
            .await
            .map_err(|_| AcpError {
                code: -32603,
                message: "connection closed".into(),
            })?;
        rx.await.map_err(|_| AcpError {
            code: -32603,
            message: "request cancelled".into(),
        })?
    }

    async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), AcpError> {
        self.cmd_tx
            .send(DispatchCmd::SendNotification {
                method: method.into(),
                params,
            })
            .await
            .map_err(|_| AcpError {
                code: -32603,
                message: "connection closed".into(),
            })?;
        Ok(())
    }
}

// ── Combined dispatch loop ──

/// The main event loop. Runs in a single tokio task. Uses `tokio::select!`
/// to concurrently read from the agent and process commands.
async fn dispatch_loop(
    reader: &mut TransportReader,
    writer: &mut TransportWriter,
    mut cmd_rx: mpsc::Receiver<DispatchCmd>,
    client: Arc<DefaultClient>,
) {
    let pending: HashMap<u64, oneshot::Sender<Result<serde_json::Value, AcpError>>> = HashMap::new();
    let pending = Arc::new(Mutex::new(pending));
    let next_id = Arc::new(Mutex::new(1u64));

    loop {
        tokio::select! {
            // Read incoming messages from agent
            read_result = reader.read_message() => {
                match read_result {
                    Ok(Some(WireMessage::Response(resp))) => {
                        if let Some(sender) = pending.lock().await.remove(&resp.id) {
                            if let Some(err) = resp.error {
                                let _ = sender.send(Err(AcpError { code: err.code, message: err.message }));
                            } else {
                                let _ = sender.send(Ok(resp.result.unwrap_or(serde_json::Value::Null)));
                            }
                        }
                    }
                    Ok(Some(WireMessage::Request(req))) => {
                        // Agent → client method call
                        let result = handle_client_method(&client, &req.method, req.params.as_ref()).await;
                        let response = match result {
                            Ok(val) => WireMessage::Response(JsonRpcResponse {
                                jsonrpc: "2.0".into(),
                                id: req.id,
                                result: Some(val),
                                error: None,
                            }),
                            Err(err) => WireMessage::Response(JsonRpcResponse {
                                jsonrpc: "2.0".into(),
                                id: req.id,
                                result: None,
                                error: Some(err.into()),
                            }),
                        };
                        if let Err(e) = writer.write_message(&response).await {
                            log::error!("写入客户端方法响应失败: {}", e);
                            break;
                        }
                    }
                    Ok(Some(WireMessage::Notification(notif))) => {
                        let _ = handle_client_notification(&client, &notif.method, notif.params.as_ref()).await;
                    }
                    Ok(None) => {
                        log::info!("Agent stdout 已关闭，连接断开");
                        break;
                    }
                    Err(e) => {
                        log::error!("传输读取错误: {}", e);
                        break;
                    }
                }
            }

            // Process commands from the public API
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(DispatchCmd::SendRequest { method, params, reply }) => {
                        let id = {
                            let mut n = next_id.lock().await;
                            let id = *n;
                            *n += 1;
                            id
                        };
                        pending.lock().await.insert(id, reply);
                        let req = WireMessage::Request(JsonRpcRequest {
                            jsonrpc: "2.0".into(),
                            id,
                            method,
                            params,
                        });
                        if let Err(e) = writer.write_message(&req).await {
                            log::error!("发送请求失败: {}", e);
                            break;
                        }
                    }
                    Some(DispatchCmd::SendNotification { method, params }) => {
                        let notif = WireMessage::Notification(JsonRpcNotification {
                            jsonrpc: "2.0".into(),
                            method,
                            params,
                        });
                        if let Err(e) = writer.write_message(&notif).await {
                            log::error!("发送通知失败: {}", e);
                            break;
                        }
                    }
                    Some(DispatchCmd::Shutdown) => break,
                    None => break,
                }
            }
        }
    }

    // Drain pending requests on exit
    let mut pend = pending.lock().await;
    for (_, sender) in pend.drain() {
        let _ = sender.send(Err(AcpError {
            code: -32603,
            message: "connection closed".into(),
        }));
    }
}

// ── Client method dispatching ──

async fn handle_client_method(
    client: &Arc<DefaultClient>,
    method: &str,
    params: Option<&serde_json::Value>,
) -> Result<serde_json::Value, AcpError> {
    let params = params.cloned().unwrap_or(serde_json::Value::Null);

    match method {
        "session/request_permission" => {
            let p: RequestPermissionParams = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            let resp = client.request_permission(p).await?;
            serde_json::to_value(resp).map_err(|e| AcpError {
                code: -32603,
                message: e.to_string(),
            })
        }
        "session/update" => {
            let p: SessionUpdateParams = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            client.session_update(p).await?;
            Ok(serde_json::Value::Null)
        }
        "fs/read_text_file" => {
            let p: ReadTextFileRequest = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            let resp = client.read_text_file(p).await?;
            serde_json::to_value(resp).map_err(|e| AcpError {
                code: -32603,
                message: e.to_string(),
            })
        }
        "fs/write_text_file" => {
            let p: WriteTextFileRequest = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            client.write_text_file(p).await?;
            Ok(serde_json::Value::Null)
        }
        "terminal/create" => {
            let p: CreateTerminalRequest = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            let resp = client.create_terminal(p).await?;
            serde_json::to_value(resp).map_err(|e| AcpError {
                code: -32603,
                message: e.to_string(),
            })
        }
        "terminal/output" => {
            let p: TerminalOutputRequest = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            let resp = client.terminal_output(p).await?;
            serde_json::to_value(resp).map_err(|e| AcpError {
                code: -32603,
                message: e.to_string(),
            })
        }
        "terminal/wait_for_exit" => {
            let p: TerminalIdParam = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            let resp = client.wait_for_terminal_exit(p).await?;
            serde_json::to_value(resp).map_err(|e| AcpError {
                code: -32603,
                message: e.to_string(),
            })
        }
        "terminal/kill" => {
            let p: TerminalIdParam = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            client.kill_terminal(p).await?;
            Ok(serde_json::Value::Null)
        }
        "terminal/release" => {
            let p: TerminalIdParam = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            client.release_terminal(p).await?;
            Ok(serde_json::Value::Null)
        }
        other => Err(AcpError {
            code: -32601,
            message: format!("unknown client method: {}", other),
        }),
    }
}

async fn handle_client_notification(
    client: &Arc<DefaultClient>,
    method: &str,
    params: Option<&serde_json::Value>,
) -> Result<(), AcpError> {
    let params = params.cloned().unwrap_or(serde_json::Value::Null);

    match method {
        "session/update" => {
            let p: SessionUpdateParams = serde_json::from_value(params).map_err(|e| AcpError {
                code: -32602,
                message: format!("invalid params: {}", e),
            })?;
            client.session_update(p).await
        }
        _ => {
            log::debug!("Ignored unknown notification: {}", method);
            Ok(())
        }
    }
}

// ── Errors ──

#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("Failed to spawn agent: {0}")]
    Spawn(String),
    #[error("Transport error: {0}")]
    Transport(#[from] TransportError),
}
