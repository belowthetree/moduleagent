//! Prompt builder — assembles the full prompt sent to the agent.
//!
//! For now this is a simple pass-through.  In a future iteration it will
//! inject system prompts from `config/mainagentprompt.md` and module
//! context from the graph (matching the TypeScript [`PromptBuilder`]).

use std::path::Path;

/// Builds prompts for agents.
pub struct PromptBuilder;

impl PromptBuilder {
    /// Assemble the prompt to send to the agent.
    ///
    /// Currently returns `text` unchanged.  Will be extended to include
    /// system prompts, module context, and conversation history.
    pub async fn build(_module_name: &str, text: &str, _base_path: &Path) -> String {
        // TODO: inject system prompt from config/mainagentprompt.md
        // TODO: inject module context from the module graph
        // TODO: track first-message-per-session for prompt injection
        text.to_string()
    }
}
