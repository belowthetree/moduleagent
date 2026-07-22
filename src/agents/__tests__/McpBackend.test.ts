// ---------------------------------------------------------------------------
// agents/__tests__/McpBackend.test.ts — CrossModuleRouter 回归测试
// 覆盖：wait-for 图并行边环检测、超时触发 abort 取消、
//       routeCall 不与用户流竞争共享流累积器（跨模块内容写独立文件）
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CrossModuleRouter, type CrossModuleRouterCallbacks } from '../mcp/McpBackend.js';
import { SessionStore } from '../StreamAccumulator.js';
import type { Agent } from '../Agent.js';
import type { PromptBlock } from '../kernel/types.js';

interface SendOpts {
  signal?: AbortSignal;
}

function fakeAgent(
  impl: (blocks: PromptBlock[], opts?: SendOpts) => Promise<any>,
): { agent: Agent; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(impl);
  return { agent: { sessionId: 'sess', send } as unknown as Agent, send };
}

function makeCallbacks(
  agents: Map<string, Agent>,
  extra: Partial<CrossModuleRouterCallbacks> = {},
): CrossModuleRouterCallbacks {
  return {
    getAgentEntry: (m) => agents.get(m),
    startAgent: async () => true,
    buildPromptBlocks: (_m, userText) => [{ type: 'text', text: userText }],
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('CrossModuleRouter wait-for 图', () => {
  it('并行边环检测：A 同时等待 B、C 时，B→A / C→A 均被拒绝，释放后恢复', async () => {
    const gateB = deferred<{ stopReason: string; content: string }>();
    const gateC = deferred<{ stopReason: string; content: string }>();
    const a = fakeAgent(async () => ({ stopReason: 'end_turn', content: 'A答复' }));
    const b = fakeAgent(() => gateB.promise);
    const c = fakeAgent(() => gateC.promise);
    const agents = new Map<string, Agent>([['A', a.agent], ['B', b.agent], ['C', c.agent]]);
    const router = new CrossModuleRouter(makeCallbacks(agents));

    // A 并行委派 B、C（routeCall 同步执行到 entry.send，两条等待边立即建立）
    const pAB = router.routeCall({ targetModule: 'B', requestingModule: 'A', task: 't1' });
    const pAC = router.routeCall({ targetModule: 'C', requestingModule: 'A', task: 't2' });
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(c.send).toHaveBeenCalledTimes(1);

    // 旧实现中 A→B 边会被 A→C 覆盖导致漏检；现在两条边都在，反向调用均构成等待环
    const rBA = await router.routeCall({ targetModule: 'A', requestingModule: 'B', task: 'back-B' });
    expect(rBA.success).toBe(false);
    expect(rBA.error).toContain('等待环');
    expect(a.send).not.toHaveBeenCalled();

    const rCA = await router.routeCall({ targetModule: 'A', requestingModule: 'C', task: 'back-C' });
    expect(rCA.success).toBe(false);
    expect(rCA.error).toContain('等待环');

    // 正常完成后按边删除，B→A 恢复可用
    gateB.resolve({ stopReason: 'end_turn', content: 'B答复' });
    gateC.resolve({ stopReason: 'end_turn', content: 'C答复' });
    await expect(pAB).resolves.toMatchObject({ success: true, result: 'B答复' });
    await expect(pAC).resolves.toMatchObject({ success: true, result: 'C答复' });

    const rBA2 = await router.routeCall({ targetModule: 'A', requestingModule: 'B', task: 'back-B-2' });
    expect(rBA2.success).toBe(true);
    expect(a.send).toHaveBeenCalledTimes(1);
  });
});

describe('CrossModuleRouter 超时取消', () => {
  it('超时触发 abort：在途 send 收到取消信号，routeCall 返回超时错误', async () => {
    let observed: AbortSignal | undefined;
    const b = fakeAgent((_blocks, opts) => {
      observed = opts?.signal;
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const err = new Error('send canceled');
          err.name = 'Canceled';
          reject(err);
        }, { once: true });
      });
    });
    const agents = new Map<string, Agent>([['B', b.agent]]);
    const router = new CrossModuleRouter(makeCallbacks(agents), { timeoutMs: 30 });

    const res = await router.routeCall({ targetModule: 'B', requestingModule: 'A', task: '慢任务' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('超时');
    // 超时与 AbortController 关联：send 收到的 signal 已被 abort
    expect(observed).toBeInstanceOf(AbortSignal);
    expect(observed?.aborted).toBe(true);
  });
});

describe('CrossModuleRouter 与用户流隔离', () => {
  it('routeCall 期间目标模块已有用户流：用户流累积器不被替换，跨模块内容写入独立文件', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ma-mcp-'));
    try {
      const store = new SessionStore(tmp);
      await store.initContextDir();

      // 用户正在进行的流式对话
      store.startStream('B');
      store.appendChunk('B', 'agent_message_chunk', {
        content: { type: 'text', text: '用户回复进行中' },
      });
      const userAcc = store.getStreamState('B');

      const b = fakeAgent(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { stopReason: 'end_turn', content: '跨模块回复内容' };
      });
      const agents = new Map<string, Agent>([['B', b.agent]]);
      const callbacks = makeCallbacks(agents, {
        appendCrossContext: (m, req, res) => store.appendCrossContext(m, req, res),
      });
      const router = new CrossModuleRouter(callbacks);

      const res = await router.routeCall({ targetModule: 'B', requestingModule: 'A', task: '跨模块任务' });
      expect(res.success).toBe(true);
      expect(res.result).toBe('跨模块回复内容');

      // send 收到了 AbortSignal（超时取消链路已接通）
      expect(b.send.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);

      // 用户流累积器未被替换、内容未被污染、未被提前 finish
      expect(store.getStreamState('B')).toBe(userAcc);
      expect(userAcc?.reply).toBe('用户回复进行中');
      expect(userAcc?.finished).toBeFalsy();

      // 跨模块内容写入独立上下文文件（appendCrossContext 为 fire-and-forget，等待落盘）
      await vi.waitFor(async () => {
        expect((await store.loadContext('B')).length).toBe(2);
      }, { timeout: 2000 });
      const msgs = await store.loadContext('B');
      expect(msgs[0]!.role).toBe('user');
      expect(msgs[0]!.content).toContain('[跨模块请求 from A]');
      expect(msgs[0]!.content).toContain('跨模块任务');
      expect(msgs[1]).toMatchObject({ role: 'agent', content: '跨模块回复内容' });
      // 用户流内容不会被当作跨模块回复写入
      expect(JSON.stringify(msgs)).not.toContain('用户回复进行中');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
