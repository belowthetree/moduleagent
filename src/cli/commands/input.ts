import { clearLine, cursorTo, createInterface } from 'readline';
import type { Interface } from 'readline';

// ── ANSI ──
const INVERT = '\x1b[7m';
const RESET = '\x1b[0m';
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

/** Display width: ASCII=1, CJK/fullwidth=2, ANSI escapes=0 */
function displayWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x1b) {
      // Skip ANSI escape sequence
      while (i < text.length && text[i] !== 'm') i++;
      continue;
    }
    // ASCII printable
    if (c >= 0x20 && c <= 0x7e) { w += 1; continue; }
    // Fullwidth: CJK, fullwidth forms, etc.
    w += 2;
  }
  return w;
}

// ── Commands ──
interface CommandDef { cmd: string; desc: string; takesArg: boolean; }

const COMMANDS: CommandDef[] = [
  { cmd: '/list', desc: 'List all modules', takesArg: false },
  { cmd: '/tree', desc: 'Show module tree with status', takesArg: false },
  { cmd: '/switch', desc: 'Switch to module <name>', takesArg: true },
  { cmd: '/status', desc: 'Show current module info', takesArg: false },
  { cmd: '/quit', desc: 'Exit TUI', takesArg: false },
  { cmd: '/help', desc: 'Show this help', takesArg: false },
];

export interface InputCallbacks {
  onLine: (line: string) => void;
  onShutdown: () => void;
  getStatusBar: () => string;
}

export class TuiInput {
  private buffer = '';
  private cursor = 0;
  private mode: 'chat' | 'command' = 'chat';
  private candidates: CommandDef[] = [];
  private selectedIdx = 0;
  private callbacks: InputCallbacks;
  private inputRow = 0;
  private stdin: NodeJS.ReadStream;
  private prevRaw: boolean;
  private rl?: Interface;

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
    this.stdin = process.stdin;
    this.prevRaw = this.stdin.isRaw ?? false;
  }

  // ── Lifecycle ──

  start(): void {
    if (this.stdin.isTTY !== true) {
      this.startReadline();
      return;
    }
    // Remove stale listeners from setup's readline before taking over
    this.stdin.removeAllListeners('data');
    this.stdin.setRawMode(true);
    this.stdin.on('data', this.onData);
    this.inputRow = (process.stdout.rows || 24) - 3;
    this.renderInput();
  }

  stop(): void {
    if (this.rl) { this.rl.close(); return; }
    this.stdin.removeListener('data', this.onData);
    if (this.stdin.isTTY && !this.stdin.destroyed) {
      try { this.stdin.setRawMode(false); } catch {}
    }
    process.stdout.write('\n');
  }

  redrawPrompt(): void {
    if (this.rl) return;
    this.inputRow = (process.stdout.rows || 24) - 3;
    this.renderInput();
  }

  renderInput(row?: number): void {
    if (this.rl) return;
    if (row !== undefined) this.inputRow = row;
    const cols = process.stdout.columns || 80;
    cursorTo(process.stdout, 0, this.inputRow);
    clearLine(process.stdout, 0);
    const line = '> ' + this.buffer;
    process.stdout.write(line);
    const cursorCol = Math.min(2 + displayWidth(this.buffer.slice(0, this.cursor)), cols - 1);
    cursorTo(process.stdout, cursorCol, this.inputRow);
  }

  private startReadline(): void {
    if (process.stdin.destroyed) return; // stdin already closed (pipe mode with buffered lines)
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    this.rl.on('line', (line) => this.callbacks.onLine(line));
    this.rl.on('close', () => this.callbacks.onShutdown());
  }

  // ── Key handler ──

  private onData = (data: Buffer): void => {
    const str = data.toString();
    let i = 0;

    while (i < str.length) {
      if (str[i] === '\x1b') {
        if (str.startsWith('\x1b[', i)) {
          const end = str.indexOf('~', i);
          const seq = end > i ? str.slice(i, end + 1) : str.slice(i, i + 3);
          this.handleAnsi(seq);
          i += seq.length;
        } else {
          if (this.mode === 'command') this.cancelCommand();
          i++;
        }
        continue;
      }

      const code = str.codePointAt(i) ?? 0;

      if (code === 3) { this.callbacks.onShutdown(); return; }

      if (code === 9) {
        if (this.mode === 'command') this.acceptCandidate();
        i++; continue;
      }

      if (code === 13) {
        if (this.mode === 'command') this.acceptCandidate();
        else this.submitLine();
        i++; continue;
      }

      if (code === 127 || code === 8) { this.handleBackspace(); i++; continue; }

      if (code >= 32 && code !== 127) this.insertChar(str[i]!);
      i++;
    }
  };

  private handleAnsi(seq: string): void {
    switch (seq) {
      case '\x1b[A': // Up
        if (this.mode === 'command') {
          this.selectedIdx = Math.max(0, this.selectedIdx - 1);
          this.renderCommandMode();
        }
        break;
      case '\x1b[B': // Down
        if (this.mode === 'command') {
          this.selectedIdx = Math.min(this.candidates.length - 1, this.selectedIdx + 1);
          this.renderCommandMode();
        }
        break;
      case '\x1b[C':
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        if (this.mode === 'chat') this.renderInput();
        break;
      case '\x1b[D':
        this.cursor = Math.max(0, this.cursor - 1);
        if (this.mode === 'chat') this.renderInput();
        break;
    }
  }

  // ── Buffer mutations ──

  private insertChar(ch: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
    this.cursor++;

    if (this.mode === 'chat' && this.buffer.startsWith('/') && !this.buffer.includes(' ')) {
      this.mode = 'command';
      this.updateCandidates();
      this.renderCommandMode();
    } else if (this.mode === 'command') {
      this.updateCandidates();
      this.renderCommandMode();
    } else {
      this.renderInput();
    }
  }

  private handleBackspace(): void {
    if (this.cursor === 0) {
      if (this.mode === 'command' && this.buffer.length <= 1) { this.cancelCommand(); return; }
      return;
    }
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor--;

    if (this.mode === 'command') {
      if (!this.buffer.startsWith('/') || this.buffer.includes(' ')) {
        this.cancelCommand(); return;
      }
      this.updateCandidates();
      this.renderCommandMode();
    } else {
      this.renderInput();
    }
  }

  private submitLine(): void {
    const line = this.buffer;
    this.buffer = '';
    this.cursor = 0;
    this.mode = 'chat';
    process.stdout.write('\n');
    this.callbacks.onLine(line);
  }

  private cancelCommand(): void {
    this.mode = 'chat';
    this.buffer = '';
    this.cursor = 0;
    this.candidates = [];
    this.renderInput();
  }

  private acceptCandidate(): void {
    const selected = this.candidates[this.selectedIdx];
    if (!selected) return;

    if (selected.takesArg) {
      this.buffer = selected.cmd + ' ';
      this.cursor = this.buffer.length;
      this.mode = 'chat';
      this.candidates = [];
      this.renderInput();
    } else {
      this.buffer = selected.cmd;
      this.submitLine();
    }
  }

  // ── Command matching ──

  private updateCandidates(): void {
    const prefix = this.buffer.toLowerCase();
    this.candidates = COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(prefix));
    this.selectedIdx = 0;
  }

  // ── Rendering ──

  private renderCommandMode(): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    const lines: string[] = [];
    for (let i = 0; i < this.candidates.length; i++) {
      const c = this.candidates[i]!;
      let display = `  ${cyan(c.cmd)}  ${dim(c.desc)}`;
      if (c.takesArg) display += dim(' <name>');
      if (i === this.selectedIdx) display = INVERT + display.padEnd(cols) + RESET;
      lines.push(display);
    }
    if (lines.length === 0) lines.push(dim('  No matching commands'));

    const statusBar = this.callbacks.getStatusBar();
    const statusLines = statusBar.split('\n');
    const totalExtra = lines.length + 1 + statusLines.length + 1; // candidates + gap + status + input
    const startRow = Math.max(0, rows - 3 - totalExtra);

    // Render candidates
    for (let i = 0; i < lines.length; i++) {
      cursorTo(process.stdout, 0, startRow + i);
      clearLine(process.stdout, 0);
      process.stdout.write(lines[i]!);
    }

    // Gap row
    cursorTo(process.stdout, 0, startRow + lines.length);
    clearLine(process.stdout, 0);

    // Status bar
    for (let i = 0; i < statusLines.length; i++) {
      cursorTo(process.stdout, 0, startRow + lines.length + 1 + i);
      clearLine(process.stdout, 0);
      process.stdout.write(statusLines[i]!);
    }

    // Input
    cursorTo(process.stdout, 0, rows - 3);
    clearLine(process.stdout, 0);
    process.stdout.write('> ' + this.buffer);
    const cursorCol = Math.min(2 + displayWidth(this.buffer.slice(0, this.cursor)), cols - 1);
    cursorTo(process.stdout, cursorCol, rows - 3);
  }
}
