//! Stream accumulator — collects streaming chunks from an ACP session
//! and broadcasts them via SSE.
//!
//! Mirrors the TypeScript `AgentStateManager.appendChunk()` logic:
//! routes `SessionUpdate` variants into reply / thinking / tools strings
//! and a timeline array.

use agent_client_protocol::{
    util::MatchDispatch,
    schema::{
        ContentBlock, ContentChunk, SessionNotification, SessionUpdate,
    },
    Dispatch,
};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::server::state::SseEvent;

/// A single event on the response timeline.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TimelineEvent {
    ReplyChunk {
        text: String,
    },
    ThoughtChunk {
        text: String,
    },
    ToolCall {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
    },
}

/// Accumulated streaming response state.
#[derive(Debug, Clone, Default)]
pub struct StreamAccumulator {
    /// Main reply text.
    pub reply: String,
    /// Thinking / reasoning text.
    pub thinking: String,
    /// Tool-call summary text.
    pub tools: String,
    /// Ordered timeline of events.
    pub timeline: Vec<TimelineEvent>,
    /// Stop reason from the agent.
    pub stop_reason: Option<String>,
    /// Whether the stream has finished.
    pub finished: bool,
}

impl StreamAccumulator {
    /// Create an empty accumulator.
    pub fn new() -> Self {
        Self::default()
    }

    /// Process an ACP dispatch message, update the accumulator, and
    /// optionally broadcast the chunk via SSE.
    pub async fn process_dispatch(
        &mut self,
        dispatch: Dispatch,
        sse_tx: Option<&broadcast::Sender<SseEvent>>,
    ) -> Result<(), crate::util::AppError> {
        MatchDispatch::new(dispatch)
            .if_notification(async |notif: SessionNotification| {
                match notif.update {
                    SessionUpdate::AgentMessageChunk(ContentChunk {
                        content: ContentBlock::Text(ref text),
                        ..
                    }) => {
                        let t = text.text.clone();
                        self.reply.push_str(&t);
                        self.timeline.push(TimelineEvent::ReplyChunk { text: t.clone() });
                        self.broadcast_chunk(sse_tx, "reply", &t);
                    }
                    SessionUpdate::AgentThoughtChunk(ContentChunk {
                        content: ContentBlock::Text(ref text),
                        ..
                    }) => {
                        let t = text.text.clone();
                        self.thinking.push_str(&t);
                        self.timeline.push(TimelineEvent::ThoughtChunk { text: t.clone() });
                        self.broadcast_chunk(sse_tx, "thinking", &t);
                    }
                    SessionUpdate::ToolCall(tc) => {
                        let title = if tc.title.is_empty() { "tool_call".to_string() } else { tc.title.clone() };
                        self.tools.push_str(&format!("[{}] ", title));
                        self.timeline.push(TimelineEvent::ToolCall {
                            title: title.clone(),
                            status: None,
                        });
                        self.broadcast_chunk(sse_tx, "tool_call", &title);
                    }
                    // Ignore other update types for now
                    _ => {}
                }
                Ok(())
            })
            .await
            .otherwise_ignore()
            .map_err(|e| crate::util::AppError::Acp(e.to_string()))
    }

    /// Mark the stream as finished with the given stop reason.
    pub fn finish(&mut self, stop_reason: String) {
        self.stop_reason = Some(stop_reason);
        self.finished = true;
    }

    /// Broadcast a chunk event to all SSE clients.
    fn broadcast_chunk(
        &self,
        sse_tx: Option<&broadcast::Sender<SseEvent>>,
        chunk_type: &str,
        text: &str,
    ) {
        if let Some(tx) = sse_tx {
            let event = SseEvent {
                event_type: format!("chunk-{chunk_type}"),
                data: serde_json::json!({ "text": text }),
            };
            let _ = tx.send(event);
        }
    }
}
