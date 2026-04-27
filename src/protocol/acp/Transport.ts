import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

export interface TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
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

  async start(options: TransportOptions): Promise<void> {
    const { command, args = [], env, cwd } = options;

    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd,
        windowsHide: true,
      });

      this.process.on('error', (err) => {
        reject(new Error(`Failed to spawn "${command}": ${err.message}`));
      });

      this.process.on('exit', (code) => {
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Agent process exited with code ${code}`));
        }
        this.pendingRequests.clear();
      });

      if (this.process.stderr) {
        const rl = createInterface({ input: this.process.stderr });
        rl.on('line', (line: string) => {
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
            this.dispatch(msg);
          } catch (err) {
            if (this.notificationHandler) {
              this.notificationHandler('_parse_error', { line, error: (err as Error).message });
            }
          }
        });
      }

      setTimeout(() => resolve(), 200);
    });
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
      this.write(JSON.stringify(request));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout (5min): ${method}`));
        }
      }, 300000);
    });
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = { jsonrpc: '2.0', method, params };
    this.write(JSON.stringify(notification));
  }

  private sendResponse(id: number | string, result: unknown): void {
    const response = { jsonrpc: '2.0', id, result };
    this.write(JSON.stringify(response));
  }

  private sendError(id: number | string, code: number, message: string): void {
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    this.write(JSON.stringify(response));
  }

  private write(data: string): void {
    if (!this.process?.stdin) {
      throw new Error('Transport not started or stdin not available');
    }
    this.process.stdin.write(data + '\n');
  }

  async stop(): Promise<void> {
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
