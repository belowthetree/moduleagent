//! Workflow executor — runs multi-step workflows sequentially.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use log;

use crate::agent::AgentManager;
use crate::util::AppResult;

/// Executes workflows step by step.
pub struct WorkflowExecutor {
    agent_manager: Arc<AgentManager>,
    cancel_token: CancellationToken,
}

impl WorkflowExecutor {
    pub fn new(agent_manager: Arc<AgentManager>) -> Self {
        Self {
            agent_manager,
            cancel_token: CancellationToken::new(),
        }
    }

    /// Execute a sequence of steps, feeding each step's output as the next step's input.
    pub async fn execute(
        &self,
        steps: &[WorkflowStep],
        user_input: &str,
    ) -> AppResult<String> {
        log::info!("开始执行工作流，共 {} 个步骤", steps.len());
        let mut previous_output = user_input.to_string();
        let project_root = std::env::current_dir().unwrap_or_else(|_| ".".into());

        for step in steps {
            if self.cancel_token.is_cancelled() {
                log::info!("工作流已取消");
                return Err(crate::util::AppError::Internal("workflow cancelled".into()));
            }

            log::info!("工作流步骤 [{}] 开始执行", step.name);

            let prompt = if step.input_from == "user" {
                format!("[STEP: {}]\n{}", step.name, user_input)
            } else if step.input_from == "both" {
                format!("[STEP: {}]\nUser input: {}\n\nPrevious output:\n{}", step.name, user_input, previous_output)
            } else {
                format!("[STEP: {}]\n{}", step.name, previous_output)
            };

            let result = self.agent_manager
                .send_message(&step.agent_name, &prompt, &project_root)
                .await?;

            previous_output = result.reply;
            log::info!("工作流步骤 [{}] 完成", step.name);
        }

        log::info!("工作流执行完成");
        Ok(previous_output)
    }

    /// Cancel the currently running workflow.
    pub fn cancel(&self) {
        log::info!("取消工作流");
        self.cancel_token.cancel();
    }
}

/// A single step in a workflow.
#[derive(Debug, Clone)]
pub struct WorkflowStep {
    pub name: String,
    pub agent_name: String,
    pub input_from: String, // "user", "previous", "both"
}
