import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import type { Logger } from '../../core/Logger.js';

export interface TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  logger?: Logger;
}

type RequestHandler = (method: string, params: Record<string, unknown> | undefined) => Promise<unknown>;
type NotificationHandler = (method: string, params: Record<string, unknown> | undefined) => void;

export class Transport {
  private process: ChildProcess | null = null;
  private requestHandler: RequestHandler | null = null;
  private notificationHandler: NotificationHandler | null = null;
  private pendingRequests: Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private requestCounter = 0;
  private logger: Logger | undefined;

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
  }

  async start(options: TransportOptions): Promise<void> {
    const { command, args = [], env, cwd } = options;
    this.logger = this.logger || options.logger;
    this.logger?.info(`TRANSPORT spawning: ${command} ${args.join(' ')} (cwd: ${cwd || process.cwd()})`);

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd,
        windowsHide: true,
      });

      this.process.on('error', (err) => {
        const msg = `Failed to spawn "${command}": ${err.message}`;
        this.logger?.error(`TRANSPORT ${msg}`);
        reject(new Error(msg));
      });

      this.process.on('exit', (code) => {
        this.logger?.info(`TRANSPORT agent process exited (code: ${code})`);
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Agent process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      if (this.process.stderr) {
        const rl = createInterface({ input: this.process.stderr });
        rl.on('line', (line: string) => {
          this.logger?.debug(`STDERR: ${line}`);
          if (this.notificationHandler) {
            this.notificationHandler('_stderr', { text: line });
          }
        });
      }

      if (this.process.stdout) {
        const rl = createInterface({ input: this.process.stdout });
        rl.on('line', (line: string) => {
          if (!line.trim()) return;
          try {
            const msg = JSON.parse(line);
            this.logRecv(msg);
            this.dispatch(msg);
          } catch (err) {
            this.logger?.error(`TRANSPORT parse error: ${line.slice(0, 200)}`);
            if (this.notificationHandler) {
              this.notificationHandler('_parse_error', { line, error: (err as Error).message });
            }
          }
        });
      }

      setTimeout(() => resolve(), 200);
    });
  }

  private logRecv(msg: Record<string, unknown>) {
    const method = msg.method as string | undefined;
    const id = msg.id as number | string | undefined;
    if (method && id && (msg.result !== undefined || msg.error !== undefined)) {
      this.logger?.rpc('recv', method, msg.error ? `error` : `result id=${id}`);
    } else if (method && id) {
      this.logger?.rpc('recv', method, `req id=${id}`);
    } else if (method) {
      this.logger?.rpc('recv', method, `notify`);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (msg.jsonrpc !== '2.0') return;

    const hasId = 'id' in msg;
    const hasMethod = 'method' in msg;
    const hasResult = 'result' in msg;
    const hasError = 'error' in msg;

    if (hasId && (hasResult || hasError)) {
      const response = msg as unknown as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (hasError) {
          const err = response.error!;
          pending.reject(new Error(`RPC Error ${err.code}: ${err.message}`));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    if (hasId && hasMethod) {
      const request = msg as unknown as JsonRpcRequest;
      if (this.requestHandler) {
        this.requestHandler(request.method, request.params)
          .then((result) => this.sendResponse(request.id, result))
          .catch((err) => this.sendError(request.id, -32603, err.message));
      }
      return;
    }

    if (hasMethod) {
      if (this.notificationHandler) {
        this.notificationHandler(msg.method as string, msg.params as Record<string, unknown> | undefined);
      }
    }
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestCounter;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.logSendRequest(method, params);
      this.write(JSON.stringify(request));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.logger?.rpcError(method, 'timeout (5min)');
          reject(new Error(`Request timeout (5min): ${method}`));
        }
      }, 300000);
    });
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    this.logger?.rpc('send', method, 'notify');
    const notification = { jsonrpc: '2.0', method, params };
    this.write(JSON.stringify(notification));
  }

  private sendResponse(id: number | string, result: unknown): void {
    this.logger?.rpc('send', '_response', `id=${id}`);
    const response = { jsonrpc: '2.0', id, result };
    this.write(JSON.stringify(response));
  }

  private sendError(id: number | string, code: number, message: string): void {
    this.logger?.rpcError(`_response id=${id}`, message);
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    this.write(JSON.stringify(response));
  }

  private logSendRequest(method: string, params?: Record<string, unknown>) {
    let detail = '';
    if (method === 'initialize') detail = `ver=${(params as any)?.protocolVersion}`;
    else if (method === 'session/new') detail = `cwd=${(params as any)?.cwd}`;
    else if (method === 'session/prompt') {
      const p = params as any;
      detail = `session=${p?.sessionId?.slice(0, 8)}... len=${p?.prompt?.[0]?.text?.length || 0}`;
    }
    this.logger?.rpc('send', method, detail || undefined);
  }

  private write(data: string): void {
    if (!this.process?.stdin) {
      throw new Error('Transport not started or stdin not available');
    }
    this.process.stdin.write(data + '\n');
  }

  async stop(): Promise<void> {
    this.logger?.info('TRANSPORT stopping...');
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Transport stopped'));
    }
    this.pendingRequests.clear();
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
