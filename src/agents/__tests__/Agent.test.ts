// ---------------------------------------------------------------------------
// agents/__tests__/Agent.test.ts — Agent 并发与生命周期回归测试
// 覆盖：Error 状态 send 串行化、cancel reject 排队项、signal 取消跳过排队项、
//       setConfigOption 内核模式恒 false、sessionResult 不含伪造 configOptions
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { Agent, AgentState } from '../Agent.js';
import type { KernelFactory } from '../KernelFactory.js';
import type { PromptBlock } from '../kernel/types.js';

const text = (t: string): PromptBlock[] => [{ type: 'text', text: t }];

interface FakeKernel {
  sessionId: string;
  send: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  clearContext: ReturnType<typeof vi.fn>;
  onNotification: (cb: (n: unknown) => void) => void;
}

function makeAgent(sendImpl: (blocks: PromptBlock[]) => Promise<any>): {
  kernel: FakeKernel;
  launcher: KernelFactory;
} {
  const kernel: FakeKernel = {
    sessionId: 'test-session',
    send: vi.fn(sendImpl),
    cancel: vi.fn(),
    stop: vi.fn(),
    clearContext: vi.fn(),
    onNotification: () => {},
  };
  const launcher = { create: vi.fn(async () => kernel) } as unknown as KernelFactory;
  return { kernel, launcher };
}

function startAgent(launcher: KernelFactory): Promise<Agent> {
  return Agent.start({
    name: 'test',
    config: {},
    cwd: '/tmp',
    launcher,
    onNotification: () => {},
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('Agent 并发与队列', () => {
  it('Error 状态下 send 入队串行化，出错后队列继续排空', async () => {
    const calls: string[] = [];
    const { launcher } = makeAgent(async (blocks: PromptBlock[]) => {
      const t = blocks[0]!.text;
      calls.push(`start-${t}`);
      await new Promise((r) => setTimeout(r, 10));
      calls.push(`end-${t}`);
      if (t === 'A') throw new Error('boom');
      return { stopReason: 'end_turn', content: `reply-${t}` };
    });
    const agent = await startAgent(launcher);

    await expect(agent.send(text('A'))).rejects.toThrow('boom');
    expect(agent.state).toBe(AgentState.Error);

    // Error 状态下 B、C 应排队串行执行而非绕过队列并发
    const [rb, rc] = await Promise.all([agent.send(text('B')), agent.send(text('C'))]);
    expect(rb.content).toBe('reply-B');
    expect(rc.content).toBe('reply-C');
    expect(calls).toEqual(['start-A', 'end-A', 'start-B', 'end-B', 'start-C', 'end-C']);
    // 成功处理后状态恢复 Idle
    expect(agent.state).toBe(AgentState.Idle);
  });

  it('cancel() 中止在途调用并以 Canceled 错误 reject 全部排队项，agent 保持可复用', async () => {
    const inFlight = deferred<{ stopReason: string; content: string }>();
    const { kernel, launcher } = makeAgent((blocks: PromptBlock[]) => {
      const t = blocks[0]!.text;
      if (t === 'A') {
        kernel.cancel.mockImplementation(() => {
          inFlight.resolve({ stopReason: 'cancelled', content: '' });
        });
        return inFlight.promise;
      }
      return Promise.resolve({ stopReason: 'end_turn', content: `reply-${t}` });
    });
    const agent = await startAgent(launcher);

    const pa = agent.send(text('A'));
    const pb = agent.send(text('B'));
    const pc = agent.send(text('C'));
    // A 在途，B、C 排队
    expect(agent.queueLength).toBe(2);

    await agent.cancel();

    await expect(pb).rejects.toMatchObject({ name: 'Canceled' });
    await expect(pc).rejects.toMatchObject({ name: 'Canceled' });
    // 在途的 A 以 cancelled 结果正常结束
    await expect(pa).resolves.toMatchObject({ stopReason: 'cancelled' });
    expect(agent.queueLength).toBe(0);

    // agent 保持可复用
    const rd = await agent.send(text('D'));
    expect(rd.content).toBe('reply-D');
    expect(agent.state).toBe(AgentState.Idle);
  });

  it('signal 已 abort 的排队项在执行前被跳过并以 Canceled 错误 reject', async () => {
    const inFlight = deferred<{ stopReason: string; content: string }>();
    const { kernel, launcher } = makeAgent((blocks: PromptBlock[]) => {
      if (blocks[0]!.text === 'A') return inFlight.promise;
      return Promise.resolve({ stopReason: 'end_turn', content: 'reply' });
    });
    const agent = await startAgent(launcher);

    const pa = agent.send(text('A'));
    const controller = new AbortController();
    const pb = agent.send(text('B'), { signal: controller.signal });
    controller.abort();

    inFlight.resolve({ stopReason: 'end_turn', content: 'reply-A' });
    await expect(pa).resolves.toMatchObject({ stopReason: 'end_turn' });
    await expect(pb).rejects.toMatchObject({ name: 'Canceled' });
    // B 未真正执行：kernel.send 只被调用一次（A）
    expect(kernel.send).toHaveBeenCalledTimes(1);

    // 入队前 signal 已 abort：直接 reject，不进入队列
    await expect(agent.send(text('X'), { signal: controller.signal })).rejects.toMatchObject({ name: 'Canceled' });
    expect(kernel.send).toHaveBeenCalledTimes(1);
    expect(agent.queueLength).toBe(0);
  });
});

describe('Agent 诚实的 no-op', () => {
  it('setConfigOption 内核模式恒返回 false；sessionResult 不含伪造的 configOptions', async () => {
    const { launcher } = makeAgent(() => Promise.resolve({ stopReason: 'end_turn', content: '' }));
    const agent = await startAgent(launcher);

    await expect(agent.setConfigOption('mode', 'code')).resolves.toBe(false);
    await expect(agent.setConfigOption('model', 'gpt-x')).resolves.toBe(false);
    expect(agent.sessionResult?.configOptions).toBeUndefined();
  });
});
