import { AgentLauncher, type LaunchedAgent, type AgentConfig } from './AgentLauncher.js';
import path from 'path';
import fs from 'fs';
import type { SessionNotification, McpServerStdio } from '@agentclientprotocol/sdk';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';

// ---------------------------------------------------------------------------
// WorkflowStepAgentEntry
// ---------------------------------------------------------------------------

export interface WorkflowStepAgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// WorkflowManagerOptions
// ---------------------------------------------------------------------------

export interface WorkflowManagerOptions {
  launcher: AgentLauncher;
  basePath: string;
  projectPath: string;
  workspaceRoot: string;
  logger?: Logger;
  callbacks?: {
    onSessionUpdate?: (agentName: string, sessionId: string, notification: SessionNotification) => void;
  };
}

// ---------------------------------------------------------------------------
// WorkflowManager — manages step agent lifecycle
// ---------------------------------------------------------------------------

export class WorkflowManager {
  private launcher: AgentLauncher;
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

    let launched: LaunchedAgent | null = null;

    try {
      this.logger.info(
        `startStepAgent [${key}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${workspacePath}`,
      );
      launched = await this.launcher.launch(agentConfig, `workflow:${key}`, workspacePath, this.logger);

      launched.onSessionUpdate = (_name, sessionId, notification) => {
        if (this.callbacks?.onSessionUpdate) {
          this.callbacks.onSessionUpdate(key, sessionId, notification);
        }
      };

      const mcpServers = this._buildStepMcpServers(workspacePath);
      const result = await launched.connection.newSession({ cwd: workspacePath, mcpServers });
      const sessionId = result.sessionId;

      const entry: WorkflowStepAgentEntry = {
        name: key,
        config: agentConfig,
        launched,
        sessionId,
        workspacePath,
      };
      this.agents.set(key, entry);

      this.logger.info(`startStepAgent [${key}] started, sessionId=${sessionId}`);
      return entry;
    } catch (err) {
      if (launched) {
        try { launched.process.kill(); } catch { /* ignore */ }
      }
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
      try { entry.launched.process.kill(); } catch { /* ignore */ }
      this.agents.delete(key);
      this.logger.info(`Step agent stopped: ${key}`);
    }
  }

  async stopAll(): Promise<void> {
    for (const [, entry] of this.agents) {
      try { entry.launched.process.kill(); } catch { /* ignore */ }
    }
    this.agents.clear();
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  getAgent(workflowName: string, stepName: string): WorkflowStepAgentEntry | undefined {
    return this.agents.get(WorkflowManager.agentKey(workflowName, stepName));
  }

  // -----------------------------------------------------------------------
  // Internal: build MCP servers for step agent
  // -----------------------------------------------------------------------

  private _buildStepMcpServers(workspacePath: string): McpServerStdio[] {
    const bundlePath = path.join(this.basePath, 'dist', 'mcp-role-server.cjs');
    if (!fs.existsSync(bundlePath)) {
      this.logger.warn(`MCP server bundle not found: ${bundlePath}. Run: npm run build:mcp-role-server`);
      return [];
    }

    const servers: McpServerStdio[] = [{
      name: 'workflow-step',
      command: 'node',
      args: [bundlePath, '--workspace', workspacePath],
      env: [],
    }];

    this.logger.info('Step MCP servers:');
    for (const s of servers) {
      this.logger.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
    }

    return servers;
  }
}
