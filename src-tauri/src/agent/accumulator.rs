use agent_client_protocol::{
    util::MatchDispatch,
    schema::{ContentBlock, ContentChunk, SessionNotification, SessionUpdate},
    Dispatch,
};
use log;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TimelineEvent {
    ReplyChunk { text: String },
    ThoughtChunk { text: String },
    ToolCall {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
    },
}

#[derive(Debug, Clone, Default)]
pub struct StreamAccumulator {
    pub reply: String,
    pub thinking: String,
    pub tools: String,
    pub timeline: Vec<TimelineEvent>,
    pub stop_reason: Option<String>,
    pub finished: bool,
}

impl StreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn process_dispatch(
        &mut self,
        dispatch: Dispatch,
        app_handle: Option<&AppHandle>,
    ) -> Result<(), crate::util::AppError> {
        MatchDispatch::new(dispatch)
            .if_notification(async |notif: SessionNotification| {
                match notif.update {
                    SessionUpdate::AgentMessageChunk(ContentChunk {
                        content: ContentBlock::Text(ref text),
                        ..
                    }) => {
                        let t = text.text.clone();
                        log::debug!("收到回复片段 ({} 字符)", t.chars().count());
                        self.reply.push_str(&t);
                        self.timeline.push(TimelineEvent::ReplyChunk { text: t.clone() });
                        if let Some(h) = app_handle {
                            let _ = h.emit("stream", serde_json::json!({
                                "type": "chunk-reply",
                                "data": { "text": &t }
                            }));
                        }
                    }
                    SessionUpdate::AgentThoughtChunk(ContentChunk {
                        content: ContentBlock::Text(ref text),
                        ..
                    }) => {
                        let t = text.text.clone();
                        self.thinking.push_str(&t);
                        self.timeline.push(TimelineEvent::ThoughtChunk { text: t.clone() });
                        if let Some(h) = app_handle {
                            let _ = h.emit("stream", serde_json::json!({
                                "type": "chunk-thinking",
                                "data": { "text": &t }
                            }));
                        }
                    }
                    SessionUpdate::ToolCall(tc) => {
                        let title = if tc.title.is_empty() { "tool_call".to_string() } else { tc.title.clone() };
                        log::info!("Agent 调用工具: {}", title);
                        self.tools.push_str(&format!("[{}] ", title));
                        self.timeline.push(TimelineEvent::ToolCall { title: title.clone(), status: None });
                        if let Some(h) = app_handle {
                            let _ = h.emit("stream", serde_json::json!({
                                "type": "chunk-tool_call",
                                "data": { "text": &title }
                            }));
                        }
                    }
                    _ => {}
                }
                Ok(())
            })
            .await
            .otherwise_ignore()
            .map_err(|e| crate::util::AppError::Acp(e.to_string()))
    }

    pub fn finish(&mut self, stop_reason: String) {
        self.stop_reason = Some(stop_reason);
        self.finished = true;
    }
}