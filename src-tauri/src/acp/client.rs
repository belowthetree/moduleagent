//! Client trait — handles agent → client method calls.
//!
//! This is the Rust equivalent of the TypeScript `Client` interface
//! from `@agentclientprotocol/sdk`. Agents call these methods during
//! a prompt session to read/write files, run terminal commands,
//! request permissions, and stream updates.

use crate::acp::types::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command as TokioCommand;
use tokio::io::AsyncBufReadExt;

/// Callback type for session update events (streaming).
pub type SessionUpdateFn = Arc<dyn Fn(SessionUpdateParams) + Send + Sync>;

/// The Client trait — implemented by the application host.
///
/// Each method corresponds to a JSON-RPC method that the Agent can
/// call on the Client during a session.
#[async_trait::async_trait]
pub trait Client: Send + Sync {
    /// Called when the agent requests permission (e.g. for a tool call).
    /// Default: auto-allow all.
    async fn request_permission(&self, params: RequestPermissionParams) -> Result<RequestPermissionResponse, AcpError> {
        // Auto-allow: pick the first option (usually "allow-once")
        if let Some(opt) = params.options.first() {
            Ok(RequestPermissionResponse {
                outcome: PermissionOutcome {
                    outcome: "selected".into(),
                    option_id: opt.option_id.clone(),
                },
            })
        } else {
            Ok(RequestPermissionResponse {
                outcome: PermissionOutcome {
                    outcome: "selected".into(),
                    option_id: "allow-once".into(),
                },
            })
        }
    }

    /// Called when the agent streams a session update (thinking, message chunk, tool call).
    async fn session_update(&self, params: SessionUpdateParams) -> Result<(), AcpError>;

    /// Read a file within the workspace.
    async fn read_text_file(&self, params: ReadTextFileRequest) -> Result<ReadTextFileResponse, AcpError>;

    /// Write a file within the workspace.
    async fn write_text_file(&self, params: WriteTextFileRequest) -> Result<(), AcpError>;

    /// Create a new terminal/shell subprocess.
    async fn create_terminal(&self, params: CreateTerminalRequest) -> Result<CreateTerminalResponse, AcpError>;

    /// Get current output from a terminal.
    async fn terminal_output(&self, params: TerminalOutputRequest) -> Result<TerminalOutputResponse, AcpError>;

    /// Wait for a terminal subprocess to exit.
    async fn wait_for_terminal_exit(&self, params: TerminalIdParam) -> Result<ExitStatus, AcpError>;

    /// Kill a terminal subprocess.
    async fn kill_terminal(&self, params: TerminalIdParam) -> Result<(), AcpError>;

    /// Release a terminal (cleanup resources).
    async fn release_terminal(&self, params: TerminalIdParam) -> Result<(), AcpError>;
}

// ── Default Client implementation ──

/// Internal state for the default client implementation.
struct TerminalState {
    child: tokio::process::Child,
    output: String,
    truncated: bool,
    exit_status: Option<ExitStatus>,
}

/// A concrete `Client` implementation with workspace-scoped file ops
/// and terminal management. Suitable for most ModuleAgent use cases.
pub struct DefaultClient {
    workspace_root: PathBuf,
    session_update: SessionUpdateFn,
    terminals: Mutex<HashMap<String, TerminalState>>,
    terminal_counter: Mutex<u64>,
}

impl DefaultClient {
    pub fn new(workspace_root: impl Into<PathBuf>, session_update: SessionUpdateFn) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            session_update,
            terminals: Mutex::new(HashMap::new()),
            terminal_counter: Mutex::new(0),
        }
    }

    /// Verify that `p` is within the workspace root (or equals it).
    fn resolve_path(&self, file_path: &str) -> Result<PathBuf, AcpError> {
        let p = Path::new(file_path);
        let canonical = if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.workspace_root.join(p)
        };
        // Normalize
        let ok = canonical.starts_with(&self.workspace_root) || canonical == self.workspace_root;
        if !ok {
            return Err(AcpError { code: -32000, message: format!("Access denied: {} is outside workspace", file_path) });
        }
        Ok(canonical)
    }
}

#[async_trait::async_trait]
impl Client for DefaultClient {
    async fn session_update(&self, params: SessionUpdateParams) -> Result<(), AcpError> {
        (self.session_update)(params);
        Ok(())
    }

    async fn read_text_file(&self, params: ReadTextFileRequest) -> Result<ReadTextFileResponse, AcpError> {
        let path = self.resolve_path(&params.path)?;
        let raw = tokio::fs::read_to_string(&path).await.map_err(|e| AcpError {
            code: -32001, message: format!("read_text_file: {}", e),
        })?;

        let content = if params.line.is_some() || params.limit.is_some() {
            let start = params.line.unwrap_or(1).saturating_sub(1) as usize;
            let limit = params.limit.unwrap_or(u32::MAX) as usize;
            raw.lines().skip(start).take(limit).collect::<Vec<_>>().join("\n")
        } else {
            raw
        };

        Ok(ReadTextFileResponse { content })
    }

    async fn write_text_file(&self, params: WriteTextFileRequest) -> Result<(), AcpError> {
        let path = self.resolve_path(&params.path)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| AcpError {
                code: -32002, message: format!("write_text_file: {}", e),
            })?;
        }
        tokio::fs::write(&path, &params.content).await.map_err(|e| AcpError {
            code: -32002, message: format!("write_text_file: {}", e),
        })?;
        Ok(())
    }

    async fn create_terminal(&self, params: CreateTerminalRequest) -> Result<CreateTerminalResponse, AcpError> {
        let mut counter = self.terminal_counter.lock().await;
        *counter += 1;
        let terminal_id = format!("term_{}", counter);
        drop(counter);

        let cwd = if let Some(ref req_cwd) = params.cwd {
            let p = Path::new(req_cwd);
            if p.starts_with(&self.workspace_root) || p == self.workspace_root {
                p.to_path_buf()
            } else {
                self.workspace_root.clone()
            }
        } else {
            self.workspace_root.clone()
        };

        let mut cmd = TokioCommand::new(&params.command);
        cmd.args(&params.args);
        cmd.current_dir(&cwd);
        cmd.kill_on_drop(true);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Apply env
        for env_var in &params.env {
            cmd.env(&env_var.name, &env_var.value);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| AcpError {
            code: -32003, message: format!("create_terminal: {}", e),
        })?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let byte_limit = params.output_byte_limit.unwrap_or(1_048_576) as usize;

        // Spawn output collection tasks
        let output = Arc::new(Mutex::new(String::new()));
        let truncated = Arc::new(Mutex::new(false));

        if let Some(stdout) = stdout {
            let output_clone = output.clone();
            let truncated_clone = truncated.clone();
            let limit = byte_limit;
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stdout);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let mut out = output_clone.lock().await;
                            if out.len() < limit {
                                out.push_str(&buf);
                            } else {
                                *truncated_clone.lock().await = true;
                            }
                        }
                    }
                }
            });
        }

        if let Some(stderr) = stderr {
            let output_clone = output.clone();
            let truncated_clone = truncated.clone();
            let limit = byte_limit;
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stderr);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let mut out = output_clone.lock().await;
                            if out.len() < limit {
                                out.push_str(&buf);
                            } else {
                                *truncated_clone.lock().await = true;
                            }
                        }
                    }
                }
            });
        }

        let state = TerminalState {
            child,
            output: String::new(),
            truncated: false,
            exit_status: None,
        };

        self.terminals.lock().await.insert(terminal_id.clone(), state);

        Ok(CreateTerminalResponse { terminal_id })
    }

    async fn terminal_output(&self, params: TerminalOutputRequest) -> Result<TerminalOutputResponse, AcpError> {
        let mut terminals = self.terminals.lock().await;
        let state = terminals.get_mut(&params.terminal_id).ok_or_else(|| AcpError {
            code: -32004, message: format!("terminal not found: {}", params.terminal_id),
        })?;

        // Check if process has exited
        if state.exit_status.is_none() {
            if let Ok(Some(status)) = state.child.try_wait() {
                let code = status.code().unwrap_or(-1);
                state.exit_status = Some(ExitStatus { exit_code: code, signal: None });
            }
        }

        Ok(TerminalOutputResponse {
            output: state.output.clone(),
            truncated: state.truncated,
            exit_status: state.exit_status.clone(),
        })
    }

    async fn wait_for_terminal_exit(&self, params: TerminalIdParam) -> Result<ExitStatus, AcpError> {
        let mut terminals = self.terminals.lock().await;
        let state = terminals.get_mut(&params.terminal_id).ok_or_else(|| AcpError {
            code: -32004, message: format!("terminal not found: {}", params.terminal_id),
        })?;

        if let Some(ref status) = state.exit_status {
            return Ok(status.clone());
        }

        let status = state.child.wait().await.map_err(|e| AcpError {
            code: -32005, message: format!("wait_for_terminal_exit: {}", e),
        })?;

        let code = status.code().unwrap_or(-1);
        let exit = ExitStatus { exit_code: code, signal: None };
        state.exit_status = Some(exit.clone());
        Ok(exit)
    }

    async fn kill_terminal(&self, params: TerminalIdParam) -> Result<(), AcpError> {
        let mut terminals = self.terminals.lock().await;
        if let Some(mut state) = terminals.remove(&params.terminal_id) {
            let _ = state.child.start_kill();
        }
        // Don't error if not found — already cleaned up
        Ok(())
    }

    async fn release_terminal(&self, params: TerminalIdParam) -> Result<(), AcpError> {
        let mut terminals = self.terminals.lock().await;
        if let Some(mut state) = terminals.remove(&params.terminal_id) {
            let _ = state.child.start_kill();
        }
        Ok(())
    }
}
