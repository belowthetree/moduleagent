//! NDJSON transport layer over tokio async I/O.
//!
//! Reads newline-delimited JSON from an async reader and writes
//! newline-delimited JSON to an async writer.  The reader and writer
//! are split so they can be moved into separate async tasks.

use crate::acp::types::WireMessage;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

/// The read half of the NDJSON transport.
pub struct TransportReader {
    inner: BufReader<ChildStdout>,
}

impl TransportReader {
    pub fn new(stdout: ChildStdout) -> Self {
        Self { inner: BufReader::new(stdout) }
    }

    /// Read the next JSON message from the agent's stdout.
    /// Returns `None` on EOF (agent exited).
    pub async fn read_message(&mut self) -> Result<Option<WireMessage>, TransportError> {
        let mut line = String::new();
        let n = self.inner.read_line(&mut line).await.map_err(TransportError::Io)?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        let msg: WireMessage = serde_json::from_str(trimmed).map_err(|e| {
            TransportError::Parse(format!(
                "failed to parse: {} — raw: {}",
                e,
                trimmed.chars().take(200).collect::<String>()
            ))
        })?;
        Ok(Some(msg))
    }
}

/// The write half of the NDJSON transport.
pub struct TransportWriter {
    inner: ChildStdin,
}

impl TransportWriter {
    pub fn new(stdin: ChildStdin) -> Self {
        Self { inner: stdin }
    }

    /// Write a JSON message to the agent's stdin, terminated by `\n`.
    pub async fn write_message(&mut self, msg: &WireMessage) -> Result<(), TransportError> {
        let json = serde_json::to_string(msg).map_err(|e| TransportError::Parse(e.to_string()))?;
        self.inner.write_all(json.as_bytes()).await.map_err(TransportError::Io)?;
        self.inner.write_all(b"\n").await.map_err(TransportError::Io)?;
        self.inner.flush().await.map_err(TransportError::Io)?;
        Ok(())
    }
}

/// Convenience: create a reader/writer pair from agent stdio.
pub fn split_transport(stdout: ChildStdout, stdin: ChildStdin) -> (TransportReader, TransportWriter) {
    (TransportReader::new(stdout), TransportWriter::new(stdin))
}

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    Parse(String),
}
