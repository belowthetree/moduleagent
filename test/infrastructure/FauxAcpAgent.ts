/**
 * FauxAcpAgent — 内存中的 ACP agent 模拟器
 *
 * 参考 pi-mono 的 Faux Provider 设计，用可编程的假 ACP agent 替代真实子进程，
 * 使集成测试能精确控制 agent 的回复内容、工具调用和生命周期行为。
 *
 * 架构：
 *   TransformStream (client→agent) ─┐
 *                                    ├─ AgentSideConnection (可编程 Agent 实现)
 *   TransformStream (agent→client) ─┘
 *
 * 使用示例：
 *   const faux = new FauxAcpAgent();
 *   faux.setPromptResponses([
 *     { type: 'text', content: 'hello' },
 *     { type: 'tool_call', name: 'read_file', args: { path: '/test.txt' } },
 *     { type: 'text', content: 'done' },
 *   ]);
 *
 *   const connection = faux.createClientConnection(clientFactory);
 *   const result = await connection.initialize({ ... });
 *   const session = await connection.newSession({ ... });
 *   // ...
 *
 *   // 断言 agent 收到的消息
 *   expect(faux.getReceivedPrompts()).toHaveLength(1);
 *   expect(faux.getReceivedPrompts()[0].text).toBe('hello');
 */

import { EventEmitter } from 'node:events';
import {
  ClientSideConnection,
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  Agent,
  Client,
  InitializeRequest,
  NewSessionRequest,
  LoadSessionRequest,
  AuthenticateRequest,
  PromptRequest,
  CancelNotification,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { ConnectionFactory } from '../../src/agents/AgentLauncher.js';

// ── 可编程 Agent 回复类型 ──

export interface FauxTextResponse {
  type: 'text';
  content: string;
}

export interface FauxToolCallResponse {
  type: 'tool_call';
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface FauxEndTurnResponse {
  type: 'end_turn';
  stopReason?: string;
}

export interface FauxErrorResponse {
  type: 'error';
  message: string;
}

export type FauxPromptStep =
  | FauxTextResponse
  | FauxToolCallResponse
  | FauxEndTurnResponse
  | FauxErrorResponse;

export interface FauxInitResult {
  agentCapabilities?: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    terminal?: boolean;
  };
}

export interface FauxAgentConfig {
  /** 初始化时返回的 agent capabilities */
  initResult?: FauxInitResult;
  /** 预设的 prompt 回复序列（每调一次 prompt 消费一个） */
  promptResponses?: FauxPromptStep[][];
  /** 预设的 newSession 返回 sessionId */
  sessionId?: string;
  /** 预设的 authenticate 结果 */
  authResult?: Record<string, unknown>;
}

// ── 记录的消息 ──

export interface RecordedPrompt {
  sessionId: string;
  text: string;
  mcpServers?: unknown[];
}

export interface RecordedNewSession {
  cwd: string;
  mcpServers: unknown[];
}

export class FauxAcpAgent {
  private clientToAgent: TransformStream;
  private agentToClient: TransformStream;
  private _agentConnection: AgentSideConnection | null = null;
  private _clientConnection: ClientSideConnection | null = null;

  // 可编程状态
  private initResult: FauxInitResult;
  private _sessionId: string;
  private promptResponseQueue: FauxPromptStep[][];
  private promptIndex = 0;
  private authResult: Record<string, unknown>;

  // 记录
  private recordedPrompts: RecordedPrompt[] = [];
  private recordedNewSessions: RecordedNewSession[] = [];
  private recordedCancels: CancelNotification[] = [];

  // 事件回调
  private onSessionUpdateCallback: ((notification: SessionNotification) => void) | null = null;

  constructor(config: FauxAgentConfig = {}) {
    this.clientToAgent = new TransformStream();
    this.agentToClient = new TransformStream();
    this.initResult = config.initResult ?? {};
    this._sessionId = config.sessionId ?? 'faux-session-1';
    this.promptResponseQueue = config.promptResponses ?? [];
    this.authResult = config.authResult ?? {};
  }

  // ── 公开 API ──

  /**
   * 创建一个 ConnectionFactory，可注入 AgentLauncher.LaunchOptions.createConnection。
   *
   * 用法：
   *   const faux = new FauxAcpAgent();
   *   const launcher = new AgentLauncher();
   *   const agent = await launcher.launch(config, name, cwd, logger, {
   *     createConnection: FauxAcpAgent.createFactory(faux),
   *   });
   */
  static createFactory(faux: FauxAcpAgent): ConnectionFactory {
    return (_processOptions, clientFactory) => {
      const connection = faux.createClientConnection(
        clientFactory as (agent: AgentSideConnection) => Client,
      );
      // 提供一个 mock ChildProcess 以满足 LaunchedAgent.process 类型
      const mockProcess = new EventEmitter() as unknown as import('child_process').ChildProcess;
      (mockProcess as Record<string, unknown>).pid = -1;
      (mockProcess as Record<string, unknown>).kill = () => true;
      return { connection, process: mockProcess };
    };
  }

  get sessionId(): string {
    return this._sessionId;
  }

  /** 创建连接到 faux agent 的 ClientSideConnection */
  createClientConnection(clientFactory: (agent: AgentSideConnection) => Client): ClientSideConnection {
    const clientStream = ndJsonStream(
      this.clientToAgent.writable,
      this.agentToClient.readable,
    );
    const agentStream = ndJsonStream(
      this.agentToClient.writable,
      this.clientToAgent.readable,
    );

    this._agentConnection = new AgentSideConnection(
      () => this.createAgentHandler(),
      agentStream,
    );

    this._clientConnection = new ClientSideConnection(
      () => clientFactory(this._agentConnection!),
      clientStream,
    );

    return this._clientConnection;
  }

  /** 获取 AgentSideConnection（用于在客户端侧调用 extMethod 等） */
  get agentConnection(): AgentSideConnection | null {
    return this._agentConnection;
  }

  /** 编程设置 prompt 回复序列 */
  setPromptResponses(responses: FauxPromptStep[][]): void {
    this.promptResponseQueue = responses;
    this.promptIndex = 0;
  }

  /** 追加 prompt 回复序列 */
  appendPromptResponses(responses: FauxPromptStep[][]): void {
    this.promptResponseQueue.push(...responses);
  }

  /** 设置 session 更新回调 */
  onSessionUpdate(callback: (notification: SessionNotification) => void): void {
    this.onSessionUpdateCallback = callback;
  }

  /** 获取 agent 收到的所有 prompt 内容 */
  getReceivedPrompts(): RecordedPrompt[] {
    return this.recordedPrompts;
  }

  /** 获取 agent 收到的所有 newSession 请求 */
  getReceivedNewSessions(): RecordedNewSession[] {
    return this.recordedNewSessions;
  }

  /** 获取 agent 收到的所有 cancel 通知 */
  getReceivedCancels(): CancelNotification[] {
    return this.recordedCancels;
  }

  /** 通过 agent 侧发送 session update（模拟 agent 主动推送） */
  async sendSessionUpdate(notification: SessionNotification): Promise<void> {
    if (!this._agentConnection) {
      throw new Error('AgentSideConnection not created yet. Call createClientConnection() first.');
    }
    await this._agentConnection.sessionUpdate(notification);
  }

  // ── Agent 实现 ──

  private createAgentHandler(): Agent {
    const self = this;
    return {
      async initialize(request: InitializeRequest) {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: self.initResult.agentCapabilities ?? {
            fs: { readTextFile: true, writeTextFile: true },
          },
          authMethods: [],
        };
      },

      async newSession(request: NewSessionRequest) {
        self.recordedNewSessions.push({
          cwd: request.cwd,
          mcpServers: request.mcpServers ?? [],
        });
        return {
          sessionId: self._sessionId,
          models: [],
        };
      },

      async loadSession(request: LoadSessionRequest) {
        return {
          sessionId: request.sessionId,
          models: [],
        };
      },

      async authenticate(_request: AuthenticateRequest) {
        return self.authResult;
      },

      async prompt(request: PromptRequest) {
        self.recordedPrompts.push({
          sessionId: request.sessionId,
          text: self.extractPromptText(request),
          mcpServers: request.mcpServers,
        });

        const responseSteps = self.promptResponseQueue[self.promptIndex];
        self.promptIndex = Math.min(self.promptIndex + 1, self.promptResponseQueue.length);

        if (!responseSteps || responseSteps.length === 0) {
          return { stopReason: 'end_turn' };
        }

        // 逐个发送 sessionUpdate 通知，最后返回 stopReason
        let stopReason = 'end_turn';
        for (const step of responseSteps) {
          switch (step.type) {
            case 'text': {
              const chunkId = `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              await self._agentConnection?.sessionUpdate({
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: step.content },
                },
              } as SessionNotification);
              // Small delay to let the client process the notification
              await new Promise((resolve) => setTimeout(resolve, 0));
              break;
            }

            case 'tool_call': {
              const toolCallId = step.id ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              await self._agentConnection?.sessionUpdate({
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: 'tool_call',
                  toolCallId,
                  title: step.name,
                  status: 'in_progress',
                  rawInput: step.args,
                },
              } as SessionNotification);
              await new Promise((resolve) => setTimeout(resolve, 0));
              break;
            }

            case 'end_turn': {
              stopReason = step.stopReason ?? 'end_turn';
              break;
            }

            case 'error': {
              stopReason = 'error';
              break;
            }
          }
        }

        if (self.onSessionUpdateCallback) {
          // Notify the external callback for assertions
          // (session updates are already sent via _agentConnection)
        }

        return { stopReason };
      },

      async cancel(notification: CancelNotification) {
        self.recordedCancels.push(notification);
      },
    };
  }

  private extractPromptText(request: PromptRequest): string {
    // Extract text content from the prompt message
    if (!request.message) return '';
    const msg = request.message as { content?: string | Array<{ type: string; text?: string }> };
    if (!msg.content) return '';
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n');
  }
}
