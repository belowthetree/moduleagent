import { createInterface } from 'readline';
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
  { cmd: '/clear', desc: 'Clear conversation history', takesArg: false },
  { cmd: '/help', desc: 'Show this help', takesArg: false },
];

export interface InputCallbacks {
  onLine: (line: string) => void;
  onShutdown: () => void;
  getStatusBar: () => string;
  onScroll: (delta: number) => void;
  onRefreshChat: () => void;
  onHistoryChange?: (history: string[]) => void;
}

export class TuiInput {
  private buffer = '';
  private cursor = 0;
  private mode: 'chat' | 'command' = 'chat';
  private candidates: CommandDef[] = [];
  private selectedIdx = 0;
  private callbacks: InputCallbacks;
  // Input history
  private history: string[] = [];
  private historyIdx = -1; // -1 = not navigating, else index into history[]
  private savedDraft = ''; // saved input before history navigation
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

  setHistory(lines: string[]): void {
    this.history = [...lines];
  }

  redrawPrompt(): void {
    if (this.rl) return;
    this.renderInput();
  }

  renderInput(): void {
    if (this.rl) return;
    const cols = process.stdout.columns || 80;
    const prompt = '> ';
    const before = this.buffer.slice(0, this.cursor);
    const at = this.buffer[this.cursor] || ' ';
    const after = this.buffer.slice(this.cursor + 1);
    const line = prompt + before + '\x1b[7m' + at + '\x1b[27m' + after;
    // Inline mode: \r to start of line, clear, redraw
    process.stdout.write('\r\x1b[K' + line.slice(0, cols));
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
        // X10 mouse encoding: \x1b[M + 3 bytes (b x y), each offset by 32
        if (str.startsWith('\x1b[M', i) && str.length - i >= 6) {
          const b = str.charCodeAt(i + 3) - 32;
          if (b === 64) this.callbacks.onScroll(-1);
          else if (b === 65) this.callbacks.onScroll(1);
          i += 6;
          continue;
        }

        if (str.startsWith('\x1b[', i) || str.startsWith('\x1bO', i)) {
          const tildeEnd = str.indexOf('~', i);
          // Find the final byte (a letter A-Z or a-z for CSI/SS3 sequences)
          let seqLen = 0;
          if (tildeEnd > i) {
            seqLen = tildeEnd - i + 1;
          } else {
            for (let j = i + 1; j < str.length && j < i + 30; j++) {
              const c = str.charCodeAt(j);
              if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
                seqLen = j - i + 1;
                break;
              }
            }
          }
          if (seqLen > 0) {
            const seq = str.slice(i, i + seqLen);
            this.handleAnsi(seq);
            i += seqLen;
          } else {
            i++;
          }
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

      if (code === 16 && this.mode === 'chat') { this.historyUp(); i++; continue; }
      if (code === 14 && this.mode === 'chat') { this.historyDown(); i++; continue; }

      if (code === 127 || code === 8) { this.handleBackspace(); i++; continue; }

      if (code >= 32 && code !== 127) this.insertChar(str[i]!);
      i++;
    }
  };

  private handleAnsi(seq: string): void {
    // SGR mouse events: \x1b[<N;X;Y[Mm]  (64=scroll up, 65=scroll down)
    if (seq.startsWith('\x1b[<')) {
      const m = seq.match(/^\x1b\[<(\d+);\d+;\d+[Mm]$/);
      if (m) {
        const btn = parseInt(m[1]!, 10);
        if (btn === 64) this.callbacks.onScroll(-1);
        else if (btn === 65) this.callbacks.onScroll(1);
      }
      return;
    }

    switch (seq) {
      case '\x1b[A': case '\x1bOA': // Up
        if (this.mode === 'command') {
          this.selectedIdx = Math.max(0, this.selectedIdx - 1);
          this.renderCommandMode();
        } else {
          this.historyUp();
        }
        break;
      case '\x1b[B': case '\x1bOB': // Down
        if (this.mode === 'command') {
          this.selectedIdx = Math.min(this.candidates.length - 1, this.selectedIdx + 1);
          this.renderCommandMode();
        } else {
          this.historyDown();
        }
        break;
      case '\x1b[C': case '\x1bOC':
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        if (this.mode === 'chat') this.renderInput();
        break;
      case '\x1b[D': case '\x1bOD':
        this.cursor = Math.max(0, this.cursor - 1);
        if (this.mode === 'chat') this.renderInput();
        break;
      case '\x1b[1;5A': // Ctrl+Up
        if (this.mode === 'chat') this.historyUp();
        break;
      case '\x1b[1;5B': // Ctrl+Down
        if (this.mode === 'chat') this.historyDown();
        break;
    }
  }

  private historyUp(): void {
    if (this.history.length === 0) return;
    if (this.historyIdx === -1) {
      this.savedDraft = this.buffer;
      this.historyIdx = this.history.length - 1;
    } else if (this.historyIdx > 0) {
      this.historyIdx--;
    }
    this.buffer = this.history[this.historyIdx]!;
    this.cursor = this.buffer.length;
    this.renderInput();
  }

  private historyDown(): void {
    if (this.historyIdx === -1) return;
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.buffer = this.history[this.historyIdx]!;
      this.cursor = this.buffer.length;
    } else {
      this.historyIdx = -1;
      this.buffer = this.savedDraft;
      this.cursor = this.buffer.length;
    }
    this.renderInput();
  }

  private resetHistoryNav(): void {
    if (this.historyIdx === -1) return;
    this.buffer = this.savedDraft;
    this.cursor = this.buffer.length;
    this.historyIdx = -1;
  }

  // ── Buffer mutations ──

  private insertChar(ch: string): void {
    this.resetHistoryNav();
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
      this.callbacks.onScroll(0); // typing resets scroll
      this.renderInput();
    }
  }

  private handleBackspace(): void {
    this.resetHistoryNav();
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
    // Save non-empty, non-duplicate lines to history (max 100)
    if (line.trim() && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > 100) this.history.shift();
      this.callbacks.onHistoryChange?.(this.history);
    }
    this.historyIdx = -1;
    this.savedDraft = '';
    this.buffer = '';
    this.cursor = 0;
    this.mode = 'chat';
    // Inline mode: just newline — don't render empty prompt before the message
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

    this.buffer = selected.takesArg ? selected.cmd + ' ' : selected.cmd;
    this.cursor = this.buffer.length;
    this.mode = 'chat';
    this.candidates = [];
    this.renderInput();
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

    const lines: string[] = [];
    for (let i = 0; i < this.candidates.length; i++) {
      const c = this.candidates[i]!;
      let display = `  ${cyan(c.cmd)}  ${dim(c.desc)}`;
      if (c.takesArg) display += dim(' <name>');
      if (i === this.selectedIdx) display = INVERT + display.padEnd(cols) + RESET;
      lines.push(display);
    }
    if (lines.length === 0) lines.push(dim('  No matching commands'));

    // Inline mode: print candidates as output, then redraw prompt
    for (const l of lines) process.stdout.write(l + '\n');
    this.renderInput();
  }
}
