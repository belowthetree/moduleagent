// ---------------------------------------------------------------------------
// McpBackend.ts — MCP 后端 HTTP 服务器
// 接收模块间 MCP 调用（module_call / module_query），路由到目标 Agent 并返回结果
// ---------------------------------------------------------------------------

import http from 'node:http';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import { defaultLogger } from '../core/Logger.js';
import type { Agent } from './Agent.js';

export interface McpBackendCallbacks {
  getAgentEntry(moduleName: string): Agent | undefined;
  startAgent(moduleName: string): Promise<boolean>;
  sendCrossContext?(
    source: string,
    target: string,
    direction: 'sent' | 'received',
    phase: 'request' | 'response',
    content: string,
  ): void;
  buildPromptBlocks(moduleName: string, userText: string): ContentBlock[];
  setAgentStatus?(moduleName: string, status: 'idle' | 'streaming' | 'error'): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
}

export class McpBackendServer {
  private server: http.Server | null = null;
  private port: number = 0;

  constructor(private callbacks: McpBackendCallbacks) {}

  start(): Promise<number> {
    if (this.server) {
      return Promise.resolve(this.port);
    }

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleRequest(req, res));

      server.on('error', (err) => {
        this.log('error', `MCP backend failed to start: ${err.message}`);
        reject(err);
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.server = server;
          this.log('info', `MCP backend listening on http://127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.log('info', 'MCP backend stopped');
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body) as {
          targetModule?: string;
          task?: string;
          query?: string;
          requestingModule?: string;
        };

        const targetModule = msg.targetModule;
        if (!targetModule) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Missing targetModule' }));
          return;
        }

        let entry = this.callbacks.getAgentEntry(targetModule);
        if (!entry) {
          const started = await this.callbacks.startAgent(targetModule);
          if (!started) {
            res.writeHead(404);
            res.end(
              JSON.stringify({
                success: false,
                error: `Cannot start agent for module: ${targetModule}`,
              }),
            );
            return;
          }
          entry = this.callbacks.getAgentEntry(targetModule);
          if (!entry) {
            res.writeHead(404);
            res.end(
              JSON.stringify({
                success: false,
                error: `Agent for module not available after start: ${targetModule}`,
              }),
            );
            return;
          }
        }

        const promptText = msg.task
          ? `[Cross-module request] ${msg.task}`
          : `[Cross-module query] ${msg.query}`;
        const requestingModule = msg.requestingModule || '';
        const taskContent = msg.task || msg.query || '';

        if (!this.callbacks.sendCrossContext) {
          this.log('warn', 'cross-context: sendCrossContext callback not registered');
        }

        if (requestingModule && targetModule) {
          this.log('info', `cross-context: ${requestingModule} → ${targetModule} [request]: ${taskContent.slice(0, 80)}`);
          this.callbacks.sendCrossContext?.(
            requestingModule,
            targetModule,
            'sent',
            'request',
            taskContent,
          );
          this.callbacks.sendCrossContext?.(
            targetModule,
            requestingModule,
            'received',
            'request',
            taskContent,
          );
        }

        const chunks: string[] = [];
        const prevHandler = entry.launched.onSessionUpdate;
        entry.launched.onSessionUpdate = (name, sid, notification) => {
          prevHandler?.(name, sid, notification);
          if (sid === entry.sessionId) {
            const u = notification.update;
            if (u.sessionUpdate === 'agent_message_chunk') {
              const text = (u as { content?: { text?: string } }).content?.text;
              if (text) chunks.push(text);
            } else if (u.sessionUpdate === 'agent_thought_chunk') {
              const text = (u as { content?: { thinking?: string } }).content?.thinking;
              if (text) chunks.push(text);
            }
          }
        };

        try {
          this.callbacks.setAgentStatus?.(targetModule, 'streaming');
          const promptBlocks = this.callbacks.buildPromptBlocks(targetModule, promptText);
          const result = await entry.connection.prompt({
            sessionId: entry.sessionId,
            prompt: promptBlocks,
          });
          this.callbacks.setAgentStatus?.(targetModule, 'idle');

          res.writeHead(200);
          const responseText = chunks.join('').trim();
          const isQuery = !!msg.query && !msg.task;
          res.end(
            JSON.stringify({
              success: true,
              ...(isQuery
                ? { answer: responseText || `Agent response (stopReason: ${result.stopReason})` }
                : { result: responseText || `Agent response (stopReason: ${result.stopReason})` }),
            }),
          );

          // 始终通知双方通信结果（即使 agent 未产生文本回复）
          const crossResponseText = responseText || `(无文本, stopReason: ${result.stopReason})`;
          if (requestingModule && targetModule) {
            this.callbacks.sendCrossContext?.(
              targetModule,
              requestingModule,
              'sent',
              'response',
              crossResponseText.slice(0, 200),
            );
            this.callbacks.sendCrossContext?.(
              requestingModule,
              targetModule,
              'received',
              'response',
              crossResponseText.slice(0, 200),
            );
          }
        } catch (err) {
          this.callbacks.setAgentStatus?.(targetModule, 'error');
          res.writeHead(500);
          res.end(
            JSON.stringify({
              success: false,
              error: `Prompt failed: ${(err as Error).message}`,
            }),
          );
        } finally {
          entry.launched.onSessionUpdate = prevHandler;
        }
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.callbacks.onLog) {
      this.callbacks.onLog(level, message);
    } else if (level === 'error') {
      defaultLogger.error(message);
    } else if (level === 'warn') {
      defaultLogger.warn(message);
    } else {
      defaultLogger.info(message);
    }
  }
}
