// ---------------------------------------------------------------------------
// agents/kernel/__tests__/AgentLoop.test.ts — AgentLoop 核心循环单元测试
//
// 通过 vi.mock('ai') mock generateText，覆盖：
//   (a) 多轮历史回归 —— 第二次 send 时 messages 包含第一轮 user 消息和 assistant 回复
//   (b) compact/truncate 后消息结构仍是合法 ModelMessage[]（无孤儿 tool 消息）
//   (c) maxOutputTokens / temperature 透传（未配置时不传）
//   (d) StormBreaker 干预消息在合并后进入历史，下一轮调用可见
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import type { ModelMessage } from 'ai';
import { generateText } from 'ai';
import { AgentLoop, type LoopEvents } from '../AgentLoop.js';
import { ContextCompactor } from '../ContextCompactor.js';
import type { AgentLoopConfig, KernelConfig } from '../types.js';
import { TokenEstimator } from '../../../core/TokenEstimator.js';
import type { Logger } from '../../../core/Logger.js';

// ── mock ai.generateText（保留 stepCountIs / tool / jsonSchema 等真实实现） ──

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const mockGenerateText = generateText as unknown as Mock;

// ── 测试辅助 ──

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function createEvents(): LoopEvents {
  return {
    onPhaseChange: () => {},
    onStreamChunk: () => {},
    onReasoningChunk: () => {},
    onToolCall: () => {},
    onError: () => {},
  };
}

function createLoop(config?: {
  kernelConfig?: Partial<KernelConfig>;
  truncation?: AgentLoopConfig['truncation'];
  compaction?: AgentLoopConfig['compaction'];
}): AgentLoop {
  return new AgentLoop(
    {
      kernelConfig: {
        provider: 'openai',
        apiKey: 'test-key',
        baseUrl: 'http://localhost/v1',
        model: 'test-model',
        ...config?.kernelConfig,
      },
      systemPrompt: 'test system prompt',
      workspaceRoot: process.cwd(),
      tools: [],
      truncation: config?.truncation,
      compaction: config?.compaction,
    },
    createEvents(),
    silentLogger,
  );
}

/** 捕获每次 generateText 调用时实际收到的 messages 快照（避开数组引用后续被 push 污染） */
function snapshotCalls(): ModelMessage[][] {
  const snapshots: ModelMessage[][] = [];
  mockGenerateText.mockImplementation(async (args: any) => {
    snapshots.push([...(args.messages as ModelMessage[])]);
    const n = snapshots.length;
    return {
      text: `reply-${n}`,
      response: { messages: [{ role: 'assistant', content: `reply-${n}` }] },
    };
  });
  return snapshots;
}

/**
 * 校验消息序列结构合法：
 * - tool 消息 content 必须是 part 数组，且不能是孤儿
 *   （前一条必须是 assistant 或 tool）
 * - assistant 的 tool-call part 必须紧跟 tool 消息
 */
function expectValidSequence(messages: ModelMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'tool') {
      expect(Array.isArray(m.content), `messages[${i}] tool content 应为数组`).toBe(true);
      const prev = messages[i - 1];
      expect(
        prev && ['assistant', 'tool'].includes(prev.role),
        `messages[${i}] 孤儿 tool 消息（前一条 role=${prev?.role ?? '无'}）`,
      ).toBe(true);
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const hasToolCall = m.content.some((p: any) => p?.type === 'tool-call');
      if (hasToolCall) {
        const next = messages[i + 1];
        expect(
          next && next.role === 'tool',
          `messages[${i}] assistant tool-call 后未跟 tool 消息`,
        ).toBe(true);
      }
    }
  }
}

beforeEach(() => {
  mockGenerateText.mockReset();
});

// ── (a) 多轮历史回归 ──

describe('AgentLoop 多轮历史', () => {
  it('第二次 send 时 generateText 收到完整历史（user-1 + assistant-1 + user-2）', async () => {
    const snapshots = snapshotCalls();
    const loop = createLoop();

    await loop.send([{ type: 'text', text: 'hello-1' }]);
    await loop.send([{ type: 'text', text: 'hello-2' }]);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual([{ role: 'user', content: 'hello-1' }]);
    expect(snapshots[1]).toEqual([
      { role: 'user', content: 'hello-1' },
      { role: 'assistant', content: 'reply-1' },
      { role: 'user', content: 'hello-2' },
    ]);
  });
});

// ── (b) compact/truncate 结构合法性 ──

describe('AgentLoop 上下文管道结构', () => {
  it('truncate 后消息结构合法：无孤儿 tool 消息，保留 head + marker', async () => {
    // 第一次调用返回带大工具结果的历史（≈2000 tokens @ 0.25 tok/char）
    const snapshots: ModelMessage[][] = [];
    mockGenerateText.mockImplementation(async (args: any) => {
      snapshots.push([...(args.messages as ModelMessage[])]);
      if (snapshots.length === 1) {
        return {
          text: 'done-1',
          response: {
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'tool-call', toolCallId: 'c1', toolName: 'file_read', input: { path: '/a' } },
                ],
              },
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'c1',
                    toolName: 'file_read',
                    output: { type: 'text', value: 'x'.repeat(8000) },
                  },
                ],
              },
            ],
          },
        };
      }
      return {
        text: 'done-2',
        response: { messages: [{ role: 'assistant', content: 'done-2' }] },
      };
    });

    const loop = createLoop({
      truncation: { contextWindow: 1000, truncateRatio: 0.8, tailTokenBudget: 50, minKeepMessages: 2 },
    });

    await loop.send([{ type: 'text', text: 'start' }]);
    await loop.send([{ type: 'text', text: 'next' }]);

    expect(snapshots).toHaveLength(2);
    const msgs = snapshots[1]!;
    expectValidSequence(msgs);
    // head 保留
    expect(msgs[0]).toEqual({ role: 'user', content: 'start' });
    // 触发截断：中间插入 marker，大工具结果及其 assistant tool-call 一并移除
    expect(
      msgs.some(
        (m) => typeof m.content === 'string' && m.content.includes('较早的对话已被截断'),
      ),
    ).toBe(true);
    expect(msgs.some((m) => m.role === 'tool')).toBe(false);
  });

  it('compact 折叠后消息结构合法：孤儿 tool 消息并回折叠区', async () => {
    mockGenerateText.mockResolvedValue({
      text: '这是摘要',
      response: { messages: [] },
    });

    const estimator = new TokenEstimator(0.3, silentLogger);
    const compactor = new ContextCompactor(
      { compactRatio: 0.7, tailTokenBudget: 45, minFoldableTokens: 0, minIntervalMs: 0 },
      estimator,
      {} as any, // summarizerModel —— generateText 已整体 mock
      silentLogger,
    );

    const messages: ModelMessage[] = [
      { role: 'user', content: 'head context' },
      { role: 'user', content: 'big'.repeat(2000) }, // 6000 字符 ≈ 1500 tokens
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'file_read', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'file_read',
            output: { type: 'text', value: 'short result' },
          },
        ],
      },
      { role: 'user', content: 'tail question' },
    ];

    const result = await compactor.maybeCompact(messages, 1000);

    expect(result.compacted).toBe(true);
    expect(result.foldedCount).toBe(3);
    expectValidSequence(result.messages);
    // [head, summary, tail-user]
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages[1]!.role).toBe('user');
    const summaryContent = result.messages[1]!.content;
    expect(typeof summaryContent === 'string' && summaryContent.includes('这是摘要')).toBe(true);
    // 尾部只剩最后一条 user 消息（tool 消息已并回折叠区，未成为孤儿）
    expect(result.messages[result.messages.length - 1]).toEqual(messages[4]);
    expect(result.messages.some((m) => m.role === 'tool')).toBe(false);
  });
});

// ── (c) maxOutputTokens / temperature 透传 ──

describe('AgentLoop 采样参数透传', () => {
  it('配置存在时传递 maxOutputTokens / temperature，未配置时不传', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      response: { messages: [] },
    });

    const configured = createLoop({
      kernelConfig: { maxTokens: 1234, temperature: 0.3 },
    });
    await configured.send([{ type: 'text', text: 'hi' }]);
    const args1 = mockGenerateText.mock.calls[0]![0] as any;
    expect(args1.maxOutputTokens).toBe(1234);
    expect(args1.temperature).toBe(0.3);

    const plain = createLoop();
    await plain.send([{ type: 'text', text: 'hi' }]);
    const args2 = mockGenerateText.mock.calls[1]![0] as any;
    expect('maxOutputTokens' in args2).toBe(false);
    expect('temperature' in args2).toBe(false);
  });
});

// ── (d) StormBreaker 干预 ──

describe('AgentLoop StormBreaker 干预', () => {
  it('干预消息在合并后进入历史，下一轮调用可见', async () => {
    const snapshots: ModelMessage[][] = [];
    mockGenerateText.mockImplementation(async (args: any) => {
      snapshots.push([...(args.messages as ModelMessage[])]);
      if (snapshots.length === 1) {
        // 同一工具同一错误连续 3 次 → 触发 StormBreaker 干预
        for (let i = 0; i < 3; i++) {
          args.onStepFinish({
            toolCalls: [],
            toolResults: [
              { toolName: 'file_write', toolCallId: `c${i}`, error: 'permission denied /x/y' },
            ],
          });
        }
        return {
          text: 'give up',
          response: { messages: [{ role: 'assistant', content: 'give up' }] },
        };
      }
      return {
        text: 'ok',
        response: { messages: [{ role: 'assistant', content: 'ok' }] },
      };
    });

    const loop = createLoop();
    await loop.send([{ type: 'text', text: 'write file' }]);

    // 最终历史顺序：user → assistant → 干预消息（最后一条）
    const history = loop.conversationHistory;
    expectValidSequence(history);
    const last = history[history.length - 1]!;
    expect(last.role).toBe('user');
    expect(typeof last.content === 'string' && last.content.includes('陷入了循环')).toBe(true);
    const assistantIdx = history.findIndex((m) => m.role === 'assistant');
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(history.length - 1).toBeGreaterThan(assistantIdx);

    // 下一轮调用能看到干预消息
    await loop.send([{ type: 'text', text: 'try again' }]);
    const secondCallMsgs = snapshots[1]!;
    expect(
      secondCallMsgs.some(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('陷入了循环'),
      ),
    ).toBe(true);
    expectValidSequence(secondCallMsgs);
  });
});
