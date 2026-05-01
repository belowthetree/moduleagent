import { cursorTo, clearLine } from 'readline';
import { ModuleScanner } from '../../core/ModuleScanner.js';
import { ModuleGraph } from '../../core/ModuleGraph.js';
import { AgentLauncher, type LaunchedAgent } from '../../agents/AgentLauncher.js';
import { runSetup } from './setup.js';
import { TuiInput } from './input.js';
import { ContextManager, type ChatMsg, makeId, timeStr } from '../../context/ContextManager.js';
import { FileStore } from '../../context/FileStore.js';
import type { ModuleGraph as ModuleGraphType, ModuleGraphNode } from '../../types/module.js';
import type { ClientSideConnection, SessionNotification } from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';
import type { ProjectConfig } from '../../config/defaults.js';

// ── ANSI helpers ──

const CSI = '\x1b[';
const ALT_SCREEN = `${CSI}?1049h`;
const NORMAL_SCREEN = `${CSI}?1049l`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;

function color(code: number, text: string): string {
  return `${CSI}${code}m${text}${CSI}0m`;
}

const dim = (s: string) => color(2, s);
const green = (s: string) => color(32, s);
const yellow = (s: string) => color(33, s);
const cyan = (s: string) => color(36, s);
const red = (s: string) => color(31, s);
const gray = (s: string) => color(90, s);

// ── Types ──

interface AgentEntry {
  connection: ClientSideConnection;
  process: ChildProcess;
  sessionId: string;
  launched: LaunchedAgent;
}

type AgentStatus = 'idle' | 'streaming' | 'error' | 'offline';

// ── Tree rendering ──

function renderTree(graph: ModuleGraphType, agentStatuses: Map<string, AgentStatus>): string[] {
  const lines: string[] = [];
  const statusIcons: Record<AgentStatus, string> = {
    idle: green('●'),
    streaming: yellow('◉'),
    error: red('●'),
    offline: dim('○'),
  };

  function buildLines(name: string, prefix: string, isLast: boolean): void {
    const node = graph.nodes.get(name);
    if (!node) return;
    const status = agentStatuses.get(name) || 'offline';
    const icon = statusIcons[status];
    const desc = node.definition.frontmatter.description;
    const display = `${icon} ${cyan(node.name)}  ${gray(node.relativePath)}  ${dim(desc)}`;
    const connector = prefix === '' ? '' : isLast ? '└── ' : '├── ';
    lines.push(prefix + connector + display);
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const childIsLast = i === children.length - 1;
      const childPrefix = prefix + (prefix === '' ? '' : isLast ? '    ' : '│   ');
      buildLines(children[i]!, childPrefix, childIsLast);
    }
  }

  if (graph.root) buildLines(graph.root, '', true);
  return lines;
}

// ── Status bar (single line) ──

function buildStatusBar(currentModule: string, node: ModuleGraphNode | undefined, status: AgentStatus): string {
  const statusColors: Record<AgentStatus, string> = {
    idle: green('idle'),
    streaming: yellow('streaming'),
    error: red('error'),
    offline: dim('offline'),
  };
  const pathStr = node ? `  Path: ${dim(node.relativePath)}` : '';
  return `Module: ${cyan(currentModule)}${pathStr}  Agent: ${statusColors[status]}`;
}

// ── TUI Class ──

export interface TuiOptions { projectRoot: string; }

export async function tui(options: TuiOptions): Promise<void> {
  try {
    const setup = await runSetup(options.projectRoot);
    const t = new ModuleAgentTui(setup.projectRoot, setup.config, setup.bufferedLines);
    await t.run();
  } catch (err) {
    process.stderr.write(red(`\nError: ${(err as Error).message}\n`));
    process.stderr.write(dim('\nRun: module-agent tui --project <project-dir>\n'));
    process.exit(1);
  }
}

class ModuleAgentTui {
  private projectRoot: string;
  private graph!: ModuleGraphType;
  private config: ProjectConfig;
  private currentModule: string;
  private agents = new Map<string, AgentEntry>();
  private agentStatuses = new Map<string, AgentStatus>();
  private launcher = new AgentLauncher();
  private input!: TuiInput;
  private bufferedLines: string[];
  private sessionPrompted = new Set<string>();
  private running = true;
  private busy = false;
  private scrollOffset = 0;
  private ctx!: ContextManager;

  // Chat buffer — all output goes here
  private chatLines: string[] = [];
  private partialLine = ''; // incomplete agent stream line
  private thinkingStart = -1; // index in chatLines where thinking block starts
  private thinkingEnd = -1;   // index where thinking block ends (exclusive)

  constructor(projectRoot: string, config: ProjectConfig, bufferedLines: string[]) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.bufferedLines = bufferedLines;
    this.currentModule = '';
  }

  async run(): Promise<void> {
    await this.scanProject();
    this.currentModule = this.graph.root;

    this.ctx = new ContextManager(new FileStore(this.projectRoot));
    this.loadHistory();

    this.input = new TuiInput({
      onLine: (line) => this.handleLine(line),
      onShutdown: () => this.shutdown(),
      getStatusBar: () => this.getCurrentStatusBar(),
      onScroll: (delta) => this.handleScroll(delta),
    });

    process.stdout.write(ALT_SCREEN + HIDE_CURSOR);

    // Render the layout frame (sep + status + input) before processing input
    this.renderFullLayout();

    // Show cursor at input position
    process.stdout.write(SHOW_CURSOR);

    // Process buffered lines from setup (commands like /list /quit)
    for (const line of this.bufferedLines) {
      if (line.trim()) this.handleLine(line);
      if (!this.running) return;
    }

    this.input.start();
  }

  // ── Scan ──

  private async scanProject(): Promise<void> {
    const descriptors = await ModuleScanner.scan({
      projectRoot: this.projectRoot,
      extraExclude: this.config.exclude,
    });
    this.graph = new ModuleGraph().build(descriptors, this.projectRoot);
    for (const [name] of this.graph.nodes) {
      this.agentStatuses.set(name, 'offline');
    }
  }

  // ── Chat buffer ──

  private appendLine(line: string): void {
    const wrapped = this.wrapLine(line);
    for (const w of wrapped) this.chatLines.push(w);
    this.scrollOffset = 0; // new content → scroll to bottom
  }

  private appendStream(text: string): void {
    // Append streaming text to partial line, splitting on newlines
    this.partialLine += text;
    while (this.partialLine.includes('\n')) {
      const idx = this.partialLine.indexOf('\n');
      const line = this.partialLine.slice(0, idx);
      this.appendLine(line);
      this.partialLine = this.partialLine.slice(idx + 1);
    }
  }

  private flushStream(): void {
    if (this.partialLine) {
      this.appendLine(this.partialLine);
      this.partialLine = '';
    }
  }

  private collapseThinking(): void {
    if (this.thinkingStart < 0) return;
    const end = this.thinkingEnd >= 0 ? this.thinkingEnd : this.chatLines.length;
    if (this.thinkingStart >= end) { this.thinkingStart = -1; this.thinkingEnd = -1; return; }
    // Count chars in thinking block
    let totalChars = 0;
    for (let i = this.thinkingStart; i < end; i++) {
      totalChars += (this.chatLines[i] || '').replace(/\x1b\[[0-9;]*m/g, '').length;
    }
    // Replace thinking lines with collapsed summary
    this.chatLines.splice(this.thinkingStart, end - this.thinkingStart);
    this.appendLine(dim(`[Thinking: ${totalChars} chars]`));
    this.thinkingStart = -1;
    this.thinkingEnd = -1;
    this.renderChatArea();
  }

  private wrapLine(line: string): string[] {
    const cols = process.stdout.columns || 80;
    const maxW = cols - 2;
    if (line.length <= maxW) return [line];
    const result: string[] = [];
    let remaining = line;
    while (remaining.length > maxW) {
      result.push(remaining.slice(0, maxW));
      remaining = remaining.slice(maxW);
    }
    if (remaining) result.push(remaining);
    return result;
  }

  // ── Layout rendering ──

  private chatRows(): number {
    return Math.max(1, (process.stdout.rows || 24) - 4); // sep + input + sep + status
  }

  private renderChatArea(): void {
    const rows = this.chatRows();
    const total = this.chatLines.length;
    const start = Math.max(0, total - rows - this.scrollOffset);
    const visible = this.chatLines.slice(start, start + rows);
    const scrolledUp = this.scrollOffset > 0;

    for (let row = 0; row < rows; row++) {
      cursorTo(process.stdout, 0, row);
      clearLine(process.stdout, 0);
      if (row < visible.length) {
        const display = visible[row]!.length > (process.stdout.columns || 80)
          ? visible[row]!.slice(0, (process.stdout.columns || 80) - 1)
          : visible[row]!;
        process.stdout.write(display);
      }
    }

    // Scroll indicator
    if (scrolledUp && rows > 1) {
      cursorTo(process.stdout, (process.stdout.columns || 80) - 10, 0);
      process.stdout.write(dim(`  ↑${this.scrollOffset}`));
    }
  }

  private loadHistory(): void {
    const msgs = this.ctx.getMessages(this.currentModule);
    if (msgs.length === 0) return;
    this.appendLine(dim('── history ──'));
    for (const msg of msgs) {
      if (msg.role === 'user') {
        this.appendLine(green(`[you] `) + msg.content);
        this.appendLine(dim('─'.repeat(Math.min((process.stdout.columns || 80) - 2, 40))));
      } else {
        // Truncate agent response to last 3 lines for brevity
        const lines = msg.content.split('\n');
        const preview = lines.slice(-3).join('\n');
        if (lines.length > 3) this.appendLine(dim(`[agent — ${lines.length} lines]`));
        this.appendLine(preview);
        this.appendLine('');
      }
    }
    this.appendLine('');
  }

  private handleScroll(delta: number): void {
    if (delta === 0) {
      this.scrollOffset = 0;
    } else {
      const maxScroll = Math.max(0, this.chatLines.length - this.chatRows() + 1);
      this.scrollOffset = Math.max(0, Math.min(maxScroll, this.scrollOffset + delta));
    }
    this.renderChatArea();
  }

  private renderFullLayout(): void {
    const rows = process.stdout.rows || 24;
    const chatR = this.chatRows();
    const sep1 = chatR;        // separator above input
    const inputRow = chatR + 1; // input
    const sep2 = chatR + 2;    // separator below input
    const statusRow = chatR + 3; // status bar

    // Clear chat area
    for (let row = 0; row < chatR; row++) {
      cursorTo(process.stdout, 0, row);
      clearLine(process.stdout, 0);
    }

    // Separator above input
    cursorTo(process.stdout, 0, sep1);
    clearLine(process.stdout, 0);
    process.stdout.write(gray('─'.repeat(process.stdout.columns || 80)));

    // Input
    this.input.renderInput(inputRow);

    // Separator below input
    cursorTo(process.stdout, 0, sep2);
    clearLine(process.stdout, 0);
    process.stdout.write(gray('─'.repeat(process.stdout.columns || 80)));

    // Status bar
    cursorTo(process.stdout, 0, statusRow);
    clearLine(process.stdout, 0);
    process.stdout.write(this.getCurrentStatusBar());

    // Render chat content
    this.renderChatArea();
  }

  private getCurrentStatusBar(): string {
    const node = this.graph.nodes.get(this.currentModule);
    const status = this.agentStatuses.get(this.currentModule) || 'offline';
    return buildStatusBar(this.currentModule, node, status);
  }

  // ── Agent management ──

  private async ensureAgent(moduleName: string): Promise<AgentEntry> {
    const existing = this.agents.get(moduleName);
    if (existing) return existing;

    const node = this.graph.nodes.get(moduleName);
    if (!node) throw new Error(`Module not found: ${moduleName}`);

    const cmd = this.config.agents.default.command;
    const args = this.config.agents.default.args || [];
    const cwd = node.absolutePath;

    this.appendLine(dim(`[system] Starting agent for ${moduleName}...`));

    const launched = await this.launcher.launch(
      { command: cmd, args }, moduleName, cwd, undefined, { subModuleDirs: [] },
    );

    launched.onSessionUpdate = (_name, _sid, notification) => {
      this.handleStream(moduleName, notification);
    };

    const result = await launched.connection.newSession({
      cwd: launched.cwd, mcpServers: [],
    });

    this.sessionPrompted.delete(moduleName);

    const entry: AgentEntry = {
      connection: launched.connection,
      process: launched.process,
      sessionId: result.sessionId,
      launched,
    };
    this.agents.set(moduleName, entry);
    this.agentStatuses.set(moduleName, 'idle');
    this.renderStatusBar();

    return entry;
  }

  // ── Input handling ──

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      this.handleCommand(trimmed);
    } else {
      this.busy = true;
      this.appendLine(green(`[you] `) + trimmed);
      this.appendLine(dim('─'.repeat(process.stdout.columns ? Math.min(process.stdout.columns - 2, 40) : 40)));
      this.renderChatArea();
      this.sendMessage(trimmed).finally(() => {
        this.busy = false;
        this.input.redrawPrompt();
      });
    }
  }

  private async sendMessage(text: string): Promise<void> {
    this.thinkingStart = -1;
    this.thinkingEnd = -1;

    try {
      const entry = await this.ensureAgent(this.currentModule);
      const sid = entry.sessionId;

      // Save user message with sessionId
      this.ctx.addMessage(this.currentModule, {
        id: makeId(), role: 'user', content: text,
        thinking: '', tools: '', time: timeStr(),
        status: 'completed', moduleName: this.currentModule, sessionId: sid,
      });

      this.agentStatuses.set(this.currentModule, 'streaming');
      this.renderStatusBar();

      const blocks = this.buildPromptBlocks(this.currentModule, text);
      const agentStartIdx = this.chatLines.length;

      await entry.connection.prompt({
        sessionId: sid,
        prompt: blocks,
      });

      this.flushStream();
      this.collapseThinking();
      this.agentStatuses.set(this.currentModule, 'idle');
      this.renderStatusBar();

      // Save agent response
      const responseLines = this.chatLines.slice(agentStartIdx);
      const responseText = responseLines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n').trim();
      if (responseText) {
        this.ctx.addMessage(this.currentModule, {
          id: makeId(), role: 'agent', content: responseText.slice(0, 2000),
          thinking: '', tools: '', time: timeStr(),
          status: 'completed', moduleName: this.currentModule, sessionId: sid,
        });
      }
    } catch (err) {
      this.flushStream();
      this.collapseThinking();
      this.agentStatuses.set(this.currentModule, 'error');
      this.appendLine(red(`[error] ${(err as Error).message}`));
      this.renderChatArea();
      this.renderStatusBar();
    }
  }

  private handleStream(moduleName: string, notification: SessionNotification): void {
    if (moduleName !== this.currentModule) return;

    const u = notification.update;

    if (u.sessionUpdate === 'agent_thought_chunk') {
      const block = (u as { content: { type?: string; text?: string } }).content;
      if (block?.text) {
        if (this.thinkingStart === -1) {
          this.flushStream();
          this.thinkingStart = this.chatLines.length;
        }
        this.appendStream(dim(block.text));
        this.renderChatArea();
        this.input.renderInput();
      }
    } else if (u.sessionUpdate === 'agent_message_chunk') {
      const block = (u as { content: { type?: string; text?: string } }).content;
      if (block?.text) {
        if (this.thinkingStart >= 0 && this.thinkingEnd < 0) {
          this.flushStream();
          this.thinkingEnd = this.chatLines.length;
        }
        this.appendStream(block.text);
        this.renderChatArea();
        this.input.renderInput();
      }
    } else if (u.sessionUpdate === 'tool_call') {
      const title = (u as { title?: string }).title || 'tool';
      if (this.thinkingStart >= 0 && this.thinkingEnd < 0) {
        this.flushStream();
        this.thinkingEnd = this.chatLines.length;
      }
      this.appendLine(yellow(`[tool] ${title}`));
      this.renderChatArea();
      this.input.renderInput();
    }
  }

  private buildPromptBlocks(moduleName: string, userText: string) {
    const blocks: { type: 'text'; text: string }[] = [];
    const isFirst = !this.sessionPrompted.has(moduleName);

    if (isFirst) {
      this.sessionPrompted.add(moduleName);
      const node = this.graph.nodes.get(moduleName);
      if (node?.definition?.body) {
        blocks.push({
          type: 'text',
          text: `# Module: ${moduleName}\n\n${node.definition.body}\n\n---\n\n`,
        });
      }
    }

    blocks.push({ type: 'text', text: userText });
    return blocks;
  }

  private renderStatusBar(): void {
    const statusRow = this.chatRows() + 3; // sep + input + sep
    cursorTo(process.stdout, 0, statusRow);
    clearLine(process.stdout, 0);
    process.stdout.write(this.getCurrentStatusBar());
  }

  // ── Commands ──

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]!;
    const arg = parts[1] || '';

    switch (cmd) {
      case 'list': this.cmdList(); break;
      case 'tree': this.cmdTree(); break;
      case 'switch': case 's': await this.cmdSwitch(arg); break;
      case 'status': this.cmdStatus(); break;
      case 'help': case 'h': this.cmdHelp(); break;
      case 'quit': case 'q': case 'exit': this.cmdQuit(); return;
      case 'clear':
        this.ctx.clearModule(this.currentModule);
        this.appendLine(dim('Context cleared.'));
        break;
      default:
        this.appendLine(red(`Unknown command: /${cmd}`));
    }
    this.renderChatArea();
    this.renderStatusBar();
    this.input.redrawPrompt();
  }

  private cmdList(): void {
    const lines: string[] = [cyan('Modules:')];
    for (const [name, node] of this.graph.nodes) {
      const marker = name === this.currentModule ? green(' *') : '  ';
      const status = this.agentStatuses.get(name) || 'offline';
      const icons: Record<AgentStatus, string> = {
        idle: green('●'), streaming: yellow('◉'), error: red('●'), offline: dim('○'),
      };
      lines.push(`${marker} ${icons[status]} ${cyan(name)} ${dim(node.relativePath)}  ${node.definition.frontmatter.description}`);
    }
    lines.push(dim('  * = current'));
    for (const l of lines) this.appendLine(l);
  }

  private cmdTree(): void {
    for (const l of renderTree(this.graph, this.agentStatuses)) this.appendLine(l);
  }

  private async cmdSwitch(name: string): Promise<void> {
    if (!name) { this.appendLine(red('Usage: /switch <module-name>')); return; }
    if (!this.graph.nodes.has(name)) { this.appendLine(red(`Module not found: ${name}`)); return; }
    this.currentModule = name;
    this.appendLine(green(`Switched to module: ${name}`));
    this.loadHistory();
    try { await this.ensureAgent(name); } catch {}
  }

  private cmdStatus(): void {
    const node = this.graph.nodes.get(this.currentModule);
    if (!node) return;
    const status = this.agentStatuses.get(this.currentModule) || 'offline';
    const lines = [
      cyan('Current Module:'),
      `  Name:        ${node.name}`,
      `  Path:        ${node.relativePath}`,
      `  Absolute:    ${node.absolutePath}`,
      `  Description: ${node.definition.frontmatter.description}`,
      `  Parent:      ${node.parent || '(root)'}`,
      `  Children:    ${node.children.join(', ') || '(none)'}`,
      `  Agent:       ${status}`,
      `  Submodules:  ${node.definition.subModules.length}`,
    ];
    for (const l of lines) this.appendLine(l);
  }

  private cmdHelp(): void {
    const lines = [
      cyan('Commands:'),
      `  ${cyan('/list')}       List all modules`,
      `  ${cyan('/tree')}       Show module tree with status`,
      `  ${cyan('/switch')} <n> Switch to module <n>`,
      `  ${cyan('/status')}     Show current module info`,
      `  ${cyan('/clear')}      Clear conversation history`,
      `  ${cyan('/quit')}       Exit TUI`,
      `  ${cyan('/help')}       Show this help`,
    ];
    for (const l of lines) this.appendLine(l);
  }

  private cmdQuit(): void {
    this.running = false;
    this.appendLine(dim('Goodbye.'));
    this.renderChatArea();
    this.shutdown();
  }

  // ── Shutdown ──

  private shutdown(): void {
    if (!this.running) { setTimeout(() => process.exit(0), 50); return; }
    this.running = false;
    this.input.stop();
    for (const [, entry] of this.agents) {
      try { entry.process.kill(); } catch {}
    }
    this.agents.clear();
    process.stdout.write(SHOW_CURSOR + NORMAL_SCREEN + '\n');
    process.exit(0);
  }
}
