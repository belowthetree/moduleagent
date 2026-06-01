// ---------------------------------------------------------------------------
// core/Logger.ts — 日志系统
// 按日期滚动日志文件，支持 DEBUG/INFO/WARN/ERROR/RPC/SESSION 分级输出
// ---------------------------------------------------------------------------

import fs from 'fs-extra';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  dir?: string;
  level?: LogLevel;
  maxFiles?: number;
}

export class Logger {
  private dir: string;
  private level: LogLevel;
  private stream: fs.WriteStream | null = null;
  private currentDate = '';
  private static defaultDir: string | null = null;

  constructor(options: LoggerOptions = {}) {
    this.dir = options.dir || Logger.defaultDir || path.join(process.cwd(), 'logs');
    this.level = options.level ?? LogLevel.INFO;
  }

  static setDefaultDir(dir: string) {
    Logger.defaultDir = dir;
  }

  configure(dir: string, level?: LogLevel) {
    this.close();
    this.dir = dir;
    if (level !== undefined) this.level = level;
  }

  private getLogFileName(): string {
    const now = new Date();
    return `module-agent-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
  }

  private getLogFile(): string {
    return path.join(this.dir, this.getLogFileName());
  }

  private async ensureStream(): Promise<void> {
    const file = this.getLogFile();
    if (this.stream && this.currentDate === file) return;

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    await fs.ensureDir(this.dir);
    this.stream = fs.createWriteStream(file, { flags: 'a' });
    this.currentDate = file;
  }

  /** 从调用栈中提取调用者的文件位置 */
  private getCaller(): string {
    const stack = new Error().stack?.split('\n') || [];
    // 跳过: Error, getCaller, write/writeSync, log method, 最终的 caller
    // format: "    at Class.method (file:line:col)" or "    at file:line:col"
    for (let i = 3; i < stack.length; i++) {
      const line = stack[i];
      if (!line) continue;
      // 跳过 Logger 自身的帧
      if (line.includes('Logger.') || line.includes('Logger.ts')) continue;
      const match = line.match(/\((.+?):(\d+):(\d+)\)/) || line.match(/at\s+(.+?):(\d+):(\d+)/);
      if (match) {
        const file = match[1]!.replace(/\\/g, '/');
        // 只取项目内文件的短路径
        const short = file.includes('/src/') ? 'src/' + file.split('/src/').pop()! : file.split('/').slice(-2).join('/');
        return `${short}:${match[2]}`;
      }
    }
    return '';
  }

  private format(level: string, message: string): string {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const loc = this.getCaller();
    return `[${ts}] [${level}]${loc ? ` [${loc}]` : ''} ${message}\n`;
  }

  private async write(level: string, message: string): Promise<void> {
    try {
      await this.ensureStream();
      this.stream?.write(this.format(level, message));
    } catch {}
  }

  private writeSync(level: string, message: string): void {
    try {
      const dir = this.dir || path.join(process.cwd(), 'logs');
      const file = path.join(dir, `${this.getLogFileName()}`);
      if (this.stream && this.currentDate !== file) {
        try { this.stream.end(); } catch { /* ignore */ }
        this.stream = null;
      }
      if (!this.stream) {
        fs.ensureDirSync(dir);
        this.stream = fs.createWriteStream(file, { flags: 'a' });
        this.currentDate = file;
      }
      if (this.stream) {
        this.stream.write(this.format(level, message));
      }
    } catch {
      try {
        const dir = this.dir || path.join(process.cwd(), 'logs');
        const file = path.join(dir, `${this.getLogFileName()}`);
        fs.ensureDirSync(dir);
        fs.appendFileSync(file, this.format(level, message));
      } catch {
        process.stderr.write(`[LOGGER] ${level}: ${message}\n`);
      }
    }
  }

  debug(message: string) { if ((this.level ?? LogLevel.INFO) <= LogLevel.DEBUG) this.writeSync('DEBUG', message); }
  info(message: string, detail?: string) { if ((this.level ?? LogLevel.INFO) <= LogLevel.INFO) this.writeSync('INFO', detail ? `${message} (${detail})` : message); }
  warn(message: string) { if ((this.level ?? LogLevel.INFO) <= LogLevel.WARN) this.writeSync('WARN', message); }
  error(message: string) { if ((this.level ?? LogLevel.INFO) <= LogLevel.ERROR) this.writeSync('ERROR', message); }

  rpc(dir: 'send' | 'recv', method: string, detail?: string) {
    const arrow = dir === 'send' ? '→' : '←';
    const tail = detail ? ` | ${detail}` : '';
    this.debug(`RPC ${arrow} ${method}${tail}`);
  }

  rpcError(method: string, error: string) {
    this.error(`RPC ✗ ${method} | ${error}`);
  }

  session(sessionId: string, event: string, detail?: string) {
    this.info(`SESSION [${sessionId.slice(0, 8)}] ${event}${detail ? ` | ${detail}` : ''}`);
  }

  async close(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

export const defaultLogger = new Logger();
