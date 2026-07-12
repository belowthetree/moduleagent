// ---------------------------------------------------------------------------
// WorkflowManager.ts — 工作流步骤 Agent 生命周期管理器
// 管理工作流步骤 Agent 的启动/停止，构建工作流 MCP 服务器与 ACP 会话
// ---------------------------------------------------------------------------

import { KernelFactory, type AgentConfig } from '../KernelFactory.js';
import { Agent } from '../Agent.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';

// ---------------------------------------------------------------------------
// WorkflowStepAgentEntry
// ---------------------------------------------------------------------------

export interface WorkflowStepAgentEntry {
  agent: Agent;
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// WorkflowManagerOptions
// ---------------------------------------------------------------------------

export interface WorkflowManagerOptions {
  launcher: KernelFactory;
  basePath: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  callbacks?: {
    onSessionUpdate?: (agentName: string, sessionId: string, notification: any) => void;
    onQueue?: (queueLength: number) => void;
    onSystemMessage?: (text: string, queueLength: number) => void;
  };
}

// ---------------------------------------------------------------------------
// WorkflowManager — manages step agent lifecycle
// ---------------------------------------------------------------------------

export class WorkflowManager {
  private launcher: KernelFactory;
  private basePath: string;
  private projectPath: string;
  private workspaceRoot: string;
  private logger: Logger;
  private callbacks?: WorkflowManagerOptions['callbacks'];

  agents = new Map<string, WorkflowStepAgentEntry>();

  constructor(options: WorkflowManagerOptions) {
    this.launcher = options.launcher;
    this.basePath = options.basePath;
    this.projectPath = options.projectPath;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger || defaultLogger;
    this.callbacks = options.callbacks;
  }

  /** Build a key for the agents map. */
  static agentKey(workflowName: string, stepName: string): string {
    return `${workflowName}:${stepName}`;
  }

  // -----------------------------------------------------------------------
  // Start step agent
  // -----------------------------------------------------------------------

  async startStepAgent(
    workflowName: string,
    stepName: string,
    agentConfig: AgentConfig,
    workspacePath: string,
  ): Promise<WorkflowStepAgentEntry> {
    const key = WorkflowManager.agentKey(workflowName, stepName);

    const existing = this.agents.get(key);
    if (existing) return existing;

    try {
      this.logger.info(
        `startStepAgent [${key}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${workspacePath}`,
      );

      // Build onNotification callback
      const self = this;
      const onNotification = (sessionId: string, notification: any): void => {
        if (self.callbacks?.onSessionUpdate) {
          self.callbacks.onSessionUpdate(key, sessionId, notification);
        }
      };

      // Build MCP servers factory
      // Start agent via unified Agent class
      const agent = await Agent.start({
        name: `workflow:${key}`,
        config: agentConfig,
        cwd: workspacePath,
        launcher: this.launcher,
        logger: this.logger,
        onNotification,
        onQueue: self.callbacks?.onQueue,
        onSystemMessage: self.callbacks?.onSystemMessage,
      });

      const entry: WorkflowStepAgentEntry = {
        agent,
        workspacePath,
      };
      this.agents.set(key, entry);

      this.logger.info(`startStepAgent [${key}] started, sessionId=${agent.sessionId}`);
      return entry;
    } catch (err) {
      this.logger.error(`startStepAgent [${key}] failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Stop step agent
  // -----------------------------------------------------------------------

  async stopStepAgent(workflowName: string, stepName: string): Promise<void> {
    const key = WorkflowManager.agentKey(workflowName, stepName);
    const entry = this.agents.get(key);
    if (entry) {
      entry.agent.stop();
      this.agents.delete(key);
      this.logger.info(`Step agent stopped: ${key}`);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.agents) {
      entry.agent.stop();
    }
    this.agents.clear();
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getAgent(workflowName: string, stepName: string): WorkflowStepAgentEntry | undefined {
    return this.agents.get(WorkflowManager.agentKey(workflowName, stepName));
  }

}
