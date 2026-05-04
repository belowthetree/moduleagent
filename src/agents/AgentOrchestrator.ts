import { AgentLauncher, type LaunchedAgent, type AgentConfig } from './AgentLauncher.js';
import type { ModuleGraphNode, ModuleGraph as ModuleGraphType } from '../types/module.js';
import type { AgentCapabilities, SessionNotification, McpServerStdio, ContentBlock } from '@agentclientprotocol/sdk';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';
import { ConfigLoader } from '../config/ConfigLoader.js';

// ---------------------------------------------------------------------------
// AgentEntry — stored after successful launch + newSession
// ---------------------------------------------------------------------------

export interface AgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  modulePath: string;
  capabilities?: AgentCapabilities;
}

// ---------------------------------------------------------------------------
// Dependency interfaces — describe the contract each collaborator must satisfy
// ---------------------------------------------------------------------------

export interface WorkspaceIsolator {
  workspacePathForModule(
    node: ModuleGraphNode,
    workspaceRoot: string | null,
    projectRoot: string,
  ): string;

  codeSourcePathForModule(
    node: ModuleGraphNode,
    codeSource: { type: string; path?: string } | null,
  ): string;

  getSubModuleDirs(
    node: ModuleGraphNode,
    graph: ModuleGraphType | null,
    workspacePathFn: (n: ModuleGraphNode) => string,
  ): string[];

  prepareModuleWorkspace(
    node: ModuleGraphNode,
    options: {
      workspaceRoot: string | null;
      codeSource: { type: string; path?: string; url?: string; branch?: string } | null;
      graph: ModuleGraphType | null;
      gitCacheDir: Map<string, string>;
      onLog?: (msg: string) => void;
    },
  ): Promise<string>;

  resolveGitCodeSource(
    codeSource: { type: string; url?: string; branch?: string } | null,
    gitCacheDir: Map<string, string>,
    onLog?: (msg: string) => void,
  ): Promise<string>;
}

export interface PromptBuilder {
  buildPromptBlocks(options: {
    moduleName: string;
    userText: string;
    graph: ModuleGraphType | null;
    prompts: { mainPrompt: string; subPrompt: string };
    sessionPrompted: Set<string>;
  }): ContentBlock[];
}

export interface McpServerBuilder {
  buildMcpServers(options: {
    moduleName: string;
    basePath: string;
    backendPort: number;
    graphFile: string;
    nodeBin?: string;
  }): McpServerStdio[];

  writeMcpGraphFile(graph: ModuleGraphType, tempDir?: string): string;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface AgentOrchestratorOptions {
  launcher: AgentLauncher;
  workspaceIsolator: WorkspaceIsolator;
  promptBuilder: PromptBuilder;
  mcpServerBuilder: McpServerBuilder;
  basePath: string;
  projectRoot: string;
  workspaceRoot: string | null;
  codeSource: { type: string; path?: string; url?: string; branch?: string } | null;
  graph: ModuleGraphType | null;
  sessionPrompted: Set<string>;
  lastSent: Map<string, { text: string; time: number }>;
  logger?: Logger;
  callbacks?: {
    onSessionUpdate?: (moduleName: string, sessionId: string, notification: SessionNotification) => void;
    sendCrossContext?: (source: string, target: string, direction: string, phase: string, content: string) => void;
  };
}

// ---------------------------------------------------------------------------
// AgentOrchestrator — unified startup orchestrator
// ---------------------------------------------------------------------------

export class AgentOrchestrator {
  private launcher: AgentLauncher;
  private workspaceIsolator: WorkspaceIsolator;
  private promptBuilder: PromptBuilder;
  private mcpServerBuilder: McpServerBuilder;
  private basePath: string;
  private projectRoot: string;
  private workspaceRoot: string | null;
  private codeSource: { type: string; path?: string; url?: string; branch?: string } | null;
  private graph: ModuleGraphType | null;
  private logger: Logger;
  private callbacks?: AgentOrchestratorOptions['callbacks'];

  // Public state — external code reads/modifies these directly
  sessionPrompted: Set<string>;
  lastSent: Map<string, { text: string; time: number }>;

  // Mutable instance state
  gitCacheDir = new Map<string, string>();
  pendingStarts = new Map<string, Promise<AgentEntry>>();
  agents = new Map<string, AgentEntry>();
  mcpBackendPort = 0;
  mcpGraphFile = '';

  constructor(options: AgentOrchestratorOptions) {
    this.launcher = options.launcher;
    this.workspaceIsolator = options.workspaceIsolator;
    this.promptBuilder = options.promptBuilder;
    this.mcpServerBuilder = options.mcpServerBuilder;
    this.basePath = options.basePath;
    this.projectRoot = options.projectRoot;
    this.workspaceRoot = options.workspaceRoot;
    this.codeSource = options.codeSource;
    this.graph = options.graph;
    this.sessionPrompted = options.sessionPrompted;
    this.lastSent = options.lastSent;
    this.logger = options.logger || defaultLogger;
    this.callbacks = options.callbacks;
  }

  // -----------------------------------------------------------------------
  // startAgent — merged pipeline from ensureModuleAgentRunning + agent:start
  // -----------------------------------------------------------------------

  async startAgent(options: {
    moduleName: string;
    config?: AgentConfig;
  }): Promise<AgentEntry> {
    const { moduleName } = options;

    const existing = this.agents.get(moduleName);
    if (existing) return existing;

    const pending = this.pendingStarts.get(moduleName);
    if (pending) return pending;

    const promise = this._startAgentInternal(options);
    this.pendingStarts.set(moduleName, promise);

    try {
      const entry = await promise;
      return entry;
    } finally {
      this.pendingStarts.delete(moduleName);
    }
  }

  // -----------------------------------------------------------------------
  // stopAll — kill all agents, clear state
  // -----------------------------------------------------------------------

  async stopAll(): Promise<void> {
    for (const [, entry] of this.agents) {
      try { entry.launched.process.kill(); } catch { /* ignore */ }
    }
    this.agents.clear();
    this.pendingStarts.clear();
  }

  // -----------------------------------------------------------------------
  // getAgent / listAgents — query helpers
  // -----------------------------------------------------------------------

  getAgent(moduleName: string): AgentEntry | undefined {
    return this.agents.get(moduleName);
  }

  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  // -----------------------------------------------------------------------
  // Internal start pipeline
  // -----------------------------------------------------------------------

  private async _startAgentInternal(options: {
    moduleName: string;
    config?: AgentConfig;
  }): Promise<AgentEntry> {
    const { moduleName } = options;
    let launched: LaunchedAgent | null = null;

    try {
      // 1. Resolve agent config: explicit override > project config > hardcoded fallback
      const agentConfig = await this._resolveConfig(moduleName, options.config);

      // 2. Look up module node from graph
      const node = this.graph?.nodes.get(moduleName) ?? null;

      // 3-4. Prepare workspace + resolve cwd
      const cwd = await this._resolveCwd(node);

      // 5. Get sub-module directories for FsHandler routing
      const subModuleDirs = node
        ? this.workspaceIsolator.getSubModuleDirs(
            node,
            this.graph,
            (n) => this.workspaceIsolator.workspacePathForModule(n, this.workspaceRoot, this.projectRoot),
          )
        : [];

      // 6. Launch agent subprocess — 5 args, options.last is { subModuleDirs }
      this.logger.info(
        `startAgent [${moduleName}] cmd=${agentConfig.command} args=[${(agentConfig.args || []).join(',')}] cwd=${cwd}`,
      );
      launched = await this.launcher.launch(agentConfig, moduleName, cwd, this.logger, { subModuleDirs });

      // 7. Wire session-update callback
      launched.onSessionUpdate = (name, sessionId, notification) => {
        if (this.callbacks?.onSessionUpdate) {
          this.callbacks.onSessionUpdate(name, sessionId, notification);
        }
      };

      // 8. Build MCP servers (may return [] when backend is not ready)
      const mcpServers = this.mcpServerBuilder.buildMcpServers({
        moduleName,
        basePath: this.basePath,
        backendPort: this.mcpBackendPort,
        graphFile: this.mcpGraphFile,
      });

      // 9. Create ACP session — passes mcpServers to the agent
      const result = await launched.connection.newSession({ cwd: launched.cwd, mcpServers });
      const sessionId = result.sessionId;

      // 10. Reset sessionPrompted so first message injects system prompt + module context
      this.sessionPrompted.delete(moduleName);

      // 11. Build and store AgentEntry
      const entry: AgentEntry = {
        name: moduleName,
        config: agentConfig,
        launched,
        sessionId,
        modulePath: cwd,
        capabilities: launched.agentCapabilities,
      };
      this.agents.set(moduleName, entry);

      this.logger.info(`startAgent [${moduleName}] started, sessionId=${sessionId}`);
      return entry;
    } catch (err) {
      if (launched) {
        try { launched.process.kill(); } catch { /* ignore */ }
      }
      this.logger.error(`startAgent [${moduleName}] failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Helper: resolve agent config
  // -----------------------------------------------------------------------

  private async _resolveConfig(
    moduleName: string,
    explicitConfig?: AgentConfig,
  ): Promise<AgentConfig> {
    if (explicitConfig) return explicitConfig;

    try {
      const workspaceConfig = await ConfigLoader.load(this.projectRoot);
      const projectConfig = ConfigLoader.getDefaultConfig(workspaceConfig);

      const modules = projectConfig.agents.modules;
      if (modules && modules[moduleName]) {
        return {
          command: modules[moduleName]!.command,
          args: modules[moduleName]!.args,
        };
      }

      return {
        command: projectConfig.agents.default.command,
        args: projectConfig.agents.default.args || [],
      };
    } catch {
      return { command: 'opencode', args: ['acp'] };
    }
  }

  // -----------------------------------------------------------------------
  // Helper: resolve working directory for a module
  // -----------------------------------------------------------------------

  private async _resolveCwd(node: ModuleGraphNode | null): Promise<string> {
    if (!node) return this.projectRoot;

    if (this.workspaceRoot && node.relativePath !== '.') {
      await this.workspaceIsolator.prepareModuleWorkspace(node, {
        workspaceRoot: this.workspaceRoot,
        codeSource: this.codeSource,
        graph: this.graph,
        gitCacheDir: this.gitCacheDir,
      });
      return this.workspaceIsolator.workspacePathForModule(node, this.workspaceRoot, this.projectRoot);
    }

    if (node.relativePath === '.') {
      return this.projectRoot;
    }

    return node.absolutePath;
  }
}
