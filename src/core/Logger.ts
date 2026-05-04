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

  configure(dir: string, level: LogLevel) {
    this.close();
    this.dir = dir;
    this.level = level;
  }

  private getLogFile(): string {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return path.join(this.dir, `module-agent-${date}.log`);
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

  private format(level: string, message: string): string {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
    return `[${ts}] [${level}] ${message}\n`;
  }

  private async write(level: string, message: string): Promise<void> {
    try {
      await this.ensureStream();
      this.stream?.write(this.format(level, message));
    } catch {}
  }

  private writeSync(level: string, message: string): void {
    try {
      const file = this.getLogFile();
      if (this.stream && this.currentDate !== file) {
        this.stream.end();
        this.stream = null;
      }
      if (!this.stream) {
        fs.ensureDirSync(this.dir);
        this.stream = fs.createWriteStream(file, { flags: 'a' });
        this.currentDate = file;
      }
      this.stream.write(this.format(level, message));
    } catch {
      try {
        const file = this.getLogFile();
        fs.ensureDirSync(this.dir);
        fs.appendFileSync(file, this.format(level, message));
      } catch {
        process.stderr.write(`[LOGGER] ${level}: ${message}\n`);
      }
    }
  }

  debug(message: string) { if (this.level <= LogLevel.DEBUG) this.writeSync('DEBUG', message); }
  info(message: string, detail?: string) { if (this.level <= LogLevel.INFO) this.writeSync('INFO', detail ? `${message} (${detail})` : message); }
  warn(message: string) { if (this.level <= LogLevel.WARN) this.writeSync('WARN', message); }
  error(message: string) { if (this.level <= LogLevel.ERROR) this.writeSync('ERROR', message); }

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
