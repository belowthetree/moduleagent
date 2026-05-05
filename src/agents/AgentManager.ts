import type { ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { ProjectConfig } from '../config/defaults.js';
import { AgentLauncher, type LaunchedAgent, type AgentConfig } from './AgentLauncher.js';
import type { AgentCapabilities, McpServer, SessionNotification } from '@agentclientprotocol/sdk';
import type { Logger } from '../core/Logger.js';

export interface AgentEntry {
  name: string;
  config: AgentConfig;
  agent: LaunchedAgent;
  sessionId?: string;
  modulePath: string;
  capabilities?: AgentCapabilities;
}

export class AgentManager {
  private agents: Map<string, AgentEntry> = new Map();
  private launcher = new AgentLauncher();
  private config: ProjectConfig;
  private graph: ModuleGraphType;
  private mcpConfig: McpServer[];

  private logger?: Logger;

  constructor(config: ProjectConfig, graph: ModuleGraphType, mcpConfig: McpServer[] = [], logger?: Logger) {
    this.config = config;
    this.graph = graph;
    this.mcpConfig = mcpConfig;
    this.logger = logger;
  }

  async startMainAgent(
    mainCwd: string,
    onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void,
    subModuleDirs?: string[],
  ): Promise<AgentEntry> {
    const rootName = this.graph.root;
    const config = this.resolveAgentConfig(rootName);
    const agent = await this.launcher.launch(config, rootName, mainCwd, this.logger, { subModuleDirs: subModuleDirs ?? [] });
    if (onSessionUpdate) {
      agent.onSessionUpdate = onSessionUpdate;
    }
    this.logger?.info(`MCP: newSession for main agent with ${this.mcpConfig.length} mcp servers`);
    for (const s of this.mcpConfig) {
      if ('command' in s) {
        this.logger?.info(`  stdio: ${s.command} ${(s.args || []).join(' ')}`);
      }
    }
    const result = await agent.connection.newSession({ cwd: agent.cwd, mcpServers: this.mcpConfig });
    const sessionId = result.sessionId;
    this.logger?.info(`MCP: newSession OK for main, sessionId=${sessionId.slice(0, 8)}`);

    const entry: AgentEntry = {
      name: rootName,
      config,
      agent,
      sessionId,
      modulePath: mainCwd,
      capabilities: agent.agentCapabilities,
    };
    this.agents.set(rootName, entry);
    return entry;
  }

  async startModuleAgent(
    moduleName: string,
    moduleCwd: string,
    onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void,
    subModuleDirs?: string[],
  ): Promise<AgentEntry> {
    if (this.agents.has(moduleName)) {
      return this.agents.get(moduleName)!;
    }

    const config = this.resolveAgentConfig(moduleName);
    const agent = await this.launcher.launch(config, moduleName, moduleCwd, this.logger, { subModuleDirs: subModuleDirs ?? [] });
    if (onSessionUpdate) {
      agent.onSessionUpdate = onSessionUpdate;
    }
    this.logger?.info(`MCP: newSession for ${moduleName} agent with ${this.mcpConfig.length} mcp servers`);
    const result = await agent.connection.newSession({ cwd: agent.cwd, mcpServers: this.mcpConfig });
    const sessionId = result.sessionId;
    this.logger?.info(`MCP: newSession OK for ${moduleName}, sessionId=${sessionId.slice(0, 8)}`);

    const entry: AgentEntry = {
      name: moduleName,
      config,
      agent,
      sessionId,
      modulePath: moduleCwd,
      capabilities: agent.agentCapabilities,
    };
    this.agents.set(moduleName, entry);
    return entry;
  }

  private resolveAgentConfig(moduleName: string): AgentConfig {
    const modules = this.config.agents.modules;
    if (modules && modules[moduleName]) {
      return {
        command: modules[moduleName]!.command,
        args: modules[moduleName]!.args,
      };
    }
    return {
      command: this.config.agents.default.command,
      args: this.config.agents.default.args,
    };
  }

  async stopAgent(name: string): Promise<void> {
    const entry = this.agents.get(name);
    if (entry) {
      try { entry.agent.process.kill(); } catch {}
      this.agents.delete(name);
    }
  }

  async stopAll(): Promise<void> {
    for (const name of this.agents.keys()) {
      await this.stopAgent(name);
    }
  }

  getAgent(name: string): AgentEntry | undefined {
    return this.agents.get(name);
  }

  getMainAgent(): AgentEntry | undefined {
    return this.agents.get(this.graph.root);
  }

  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }
}
