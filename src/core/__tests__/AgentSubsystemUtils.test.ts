// ---------------------------------------------------------------------------
// core/__tests__/AgentSubsystemUtils.test.ts — SendGuard 互斥回归测试
// 覆盖：≥3 个并发等待者时严格串行（修复假互斥）
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { SendGuard } from '../AgentSubsystemUtils.js';

describe('SendGuard', () => {
  it('三路并发获取同一 name 时严格互斥、按序进入', async () => {
    const guard = new SendGuard();
    const order: string[] = [];
    let active = 0;
    let maxConcurrent = 0;

    const worker = async (id: string, holdMs: number) => {
      const release = await guard.acquire('m');
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      order.push(`enter-${id}`);
      await new Promise((r) => setTimeout(r, holdMs));
      order.push(`exit-${id}`);
      active--;
      release();
    };

    // 同步连续发起三个 acquire，保证三者都在竞争同一把锁
    await Promise.all([worker('a', 30), worker('b', 20), worker('c', 10)]);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(['enter-a', 'exit-a', 'enter-b', 'exit-b', 'enter-c', 'exit-c']);
  });

  it('释放后可重新获取；不同 name 互不影响', async () => {
    const guard = new SendGuard();

    const rx1 = await guard.acquire('x');
    // 不同 name 不阻塞
    const ry1 = await guard.acquire('y');
    ry1();
    rx1();

    // x 释放后可再次获取（链尾已被清理，从头开始）
    const rx2 = await guard.acquire('x');
    rx2();
  });

  it('持有者未释放时后续 acquire 一直等待', async () => {
    const guard = new SendGuard();
    const release1 = await guard.acquire('m');

    let acquired = false;
    const p = guard.acquire('m').then((release) => {
      acquired = true;
      release();
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(acquired).toBe(false);

    release1();
    await p;
    expect(acquired).toBe(true);
  });
});
