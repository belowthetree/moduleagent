// ---------------------------------------------------------------------------
// WorkflowManager.ts — 工作流步骤 Agent 生命周期管理器
// 管理工作流步骤 Agent 的启动/停止，构建工作流 MCP 服务器与 ACP 会话
// ---------------------------------------------------------------------------

import { KernelFactory, type AgentConfig } from '../KernelFactory.js';
import { Agent } from '../Agent.js';
import type { Logger } from '../../core/Logger.js';
import { defaultLogger } from '../../core/Logger.js';
import { withRetry } from '../../core/RetryPolicy.js';

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
  /** 上下文截断配置（透传 kernel，来自主配置） */
  truncation?: import('../kernel/types.js').AgentLoopConfig['truncation'];
  /** 在线压缩配置（透传 kernel，来自主配置） */
  compaction?: import('../kernel/types.js').AgentLoopConfig['compaction'];
  /** 按 agent 名解析丢弃内容存档目录 */
  archiveDirFor?: (agentName: string) => string;
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
  private truncation?: WorkflowManagerOptions['truncation'];
  private compaction?: WorkflowManagerOptions['compaction'];
  private archiveDirFor?: (agentName: string) => string;

  agents = new Map<string, WorkflowStepAgentEntry>();
  private pendingStarts = new Map<string, Promise<WorkflowStepAgentEntry>>();

  constructor(options: WorkflowManagerOptions) {
    this.launcher = options.launcher;
    this.basePath = options.basePath;
    this.projectPath = options.projectPath;
    this.workspaceRoot = options.workspaceRoot;
    this.logger = options.logger || defaultLogger;
    this.callbacks = options.callbacks;
    this.truncation = options.truncation;
    this.compaction = options.compaction;
    this.archiveDirFor = options.archiveDirFor;
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
    systemPrompt?: string,
  ): Promise<WorkflowStepAgentEntry> {
    const key = WorkflowManager.agentKey(workflowName, stepName);

    const existing = this.agents.get(key);
    if (existing) return existing;

    // 并发启动去重：同 key 复用同一个启动 Promise，防止泄漏 agent
    const pending = this.pendingStarts.get(key);
    if (pending) return pending;

    // 启动失败重试一次（重试前复查：可能已被并发调用者启动）
    const promise = withRetry(
      async () => {
        const now = this.agents.get(key);
        if (now) return now;
        return this._startStepAgentInternal(key, agentConfig, workspacePath, systemPrompt);
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1000,
        shouldRetry: () => true,
        onRetry: (attempt, delayMs, err) =>
          this.logger.warn(
            `startStepAgent [${key}] failed (attempt ${attempt}/2), retrying in ${delayMs}ms: ${(err as Error)?.message ?? err}`,
          ),
      },
    );
    this.pendingStarts.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pendingStarts.delete(key);
    }
  }

  // -----------------------------------------------------------------------
  // 内部启动管道
  // -----------------------------------------------------------------------

  private async _startStepAgentInternal(
    key: string,
    agentConfig: AgentConfig,
    workspacePath: string,
    systemPrompt?: string,
  ): Promise<WorkflowStepAgentEntry> {
    try {
      this.logger.info(`startStepAgent [${key}] cwd=${workspacePath}`);

      // Build onNotification callback
      const self = this;
      const onNotification = (sessionId: string, notification: any): void => {
        if (self.callbacks?.onSessionUpdate) {
          self.callbacks.onSessionUpdate(key, sessionId, notification);
        }
      };

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
        systemPrompt,
        truncation: this.truncation,
        compaction: this.compaction,
        archiveDir: this.archiveDirFor?.(`workflow:${key}`),
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
    this.pendingStarts.clear();
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getAgent(workflowName: string, stepName: string): WorkflowStepAgentEntry | undefined {
    return this.agents.get(WorkflowManager.agentKey(workflowName, stepName));
  }

}
