// ---------------------------------------------------------------------------
// McpBackend.ts — MCP 后端 HTTP 服务器
// 接收模块间 MCP 调用（module_call / module_query），路由到目标 Agent 并返回结果
// ---------------------------------------------------------------------------

import http from 'node:http';
import type { PromptBlock } from './kernel/types.js';
import { defaultLogger } from '../core/Logger.js';
import type { Agent } from './Agent.js';
import type { ChatMsg } from '../types/shared.js';

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
  buildPromptBlocks(moduleName: string, userText: string): PromptBlock[];
  setAgentStatus?(moduleName: string, status: 'idle' | 'streaming' | 'error'): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  /** 开始流累积（module_call 前调用，确保 accumulator 干净） */
  startStream?(moduleName: string): void;
  /** 结束流累积并返回 accumulator（module_call 后调用） */
  finishStream?(moduleName: string): { reply: string; thinking: string; tools: string; timeline?: unknown[] } | undefined;
  /** 持久化跨模块对话：load + append msgs + save */
  saveCrossContext?(moduleName: string, msgs: ChatMsg[]): Promise<void>;
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

        try {
          this.callbacks.startStream?.(targetModule);
          this.callbacks.setAgentStatus?.(targetModule, 'streaming');
          const promptBlocks = this.callbacks.buildPromptBlocks(targetModule, promptText);

          let responseText = '';
          const kernel = entry.kernel;
          if (kernel) {
            const result = await kernel.send(promptBlocks);
            responseText = result.content;
          } else {
            responseText = 'No kernel available';
          }

          this.callbacks.setAgentStatus?.(targetModule, 'idle');

          res.writeHead(200);
          const isQuery = !!msg.query && !msg.task;
          res.end(
            JSON.stringify({
              success: true,
              ...(isQuery
                ? { answer: responseText || 'Agent response' }
                : { result: responseText || 'Agent response' }),
            }),
          );

          // ── 持久化跨模块对话（子模块消息落盘） ──
          const acc = this.callbacks.finishStream?.(targetModule);
          if (acc && this.callbacks.saveCrossContext) {
            const timeStr = new Date().toLocaleTimeString();
            const baseId = 'x' + Date.now().toString(36);
            const msgs: ChatMsg[] = [];

            // 1. 跨模块请求（作为 user 消息）
            msgs.push({
              id: baseId,
              role: 'user',
              content: `[跨模块请求 from ${requestingModule || '?'}]\n${taskContent}`,
              thinking: '',
              time: timeStr,
              status: 'sent',
              moduleName: targetModule,
              sessionId: entry.sessionId,
            });

            // 2. 时间线中的工具调用（展开为独立 system 消息）
            for (const ev of (acc.timeline || []) as Array<{ type?: string; content?: string; toolCallId?: string }>) {
              if (ev.type === 'tool_call' && ev.content) {
                msgs.push({
                  id: `tool-${targetModule}-${ev.toolCallId || Math.random().toString(36).slice(2, 6)}`,
                  role: 'system',
                  content: ev.content,
                  thinking: '',
                  time: timeStr,
                  status: 'sent',
                  moduleName: targetModule,
                });
              }
            }

            // 3. Agent 回复（thinking 和 content）
            msgs.push({
              id: baseId + 'r',
              role: 'agent',
              content: acc.reply || responseText,
              thinking: acc.thinking || '',
              timeline: [],
              time: timeStr,
              status: 'completed',
              moduleName: targetModule,
            });

            this.callbacks.saveCrossContext(targetModule, msgs).catch(err => {
              this.log('warn', `MCP: saveCrossContext failed for [${targetModule}]: ${(err as Error).message}`);
            });
          }

          // 始终通知双方通信结果（即使 agent 未产生文本回复）
          const crossResponseText = responseText || '(No text)';
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
