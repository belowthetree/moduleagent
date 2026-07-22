// ---------------------------------------------------------------------------
// agents/__tests__/StreamAccumulator.test.ts — SessionStore 回归测试
// 覆盖：appendCrossContext 独立落盘、startStream 替换活跃流时告警
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SessionStore } from '../StreamAccumulator.js';
import { defaultLogger } from '../../core/Logger.js';

describe('SessionStore.appendCrossContext', () => {
  it('直接写入上下文文件，不经过活跃流；重复调用追加而非覆盖', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ma-session-'));
    try {
      const store = new SessionStore(tmp);

      // 有活跃流也不受影响
      store.startStream('m');
      const acc = store.getStreamState('m');

      await store.appendCrossContext('m', '[跨模块请求 from X]\n任务', '回复文本');

      const msgs = await store.loadContext('m');
      expect(msgs.length).toBe(2);
      expect(msgs[0]).toMatchObject({ role: 'user', content: '[跨模块请求 from X]\n任务' });
      expect(msgs[1]).toMatchObject({ role: 'agent', content: '回复文本' });

      // 活跃流保持原样
      expect(store.getStreamState('m')).toBe(acc);
      expect(acc?.reply).toBe('');

      // 再次调用是追加而非覆盖
      await store.appendCrossContext('m', '第二次请求', '第二次回复');
      const msgs2 = await store.loadContext('m');
      expect(msgs2.length).toBe(4);
      expect(msgs2[3]).toMatchObject({ role: 'agent', content: '第二次回复' });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('SessionStore.startStream 防御', () => {
  it('替换活跃流时发出 warn 日志；首次创建与替换已结束流不告警', () => {
    const warnSpy = vi.spyOn(defaultLogger, 'warn').mockImplementation(() => {});
    try {
      const store = new SessionStore(path.join(os.tmpdir(), 'ma-session-noop'));

      store.startStream('m');
      expect(warnSpy).not.toHaveBeenCalled();

      // 活跃流被替换 → 告警
      store.appendChunk('m', 'agent_message_chunk', { content: { type: 'text', text: 'hi' } });
      store.startStream('m');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain('[m]');

      // 已 finish 的流被替换 → 不告警
      store.appendChunk('m', 'agent_message_chunk', { content: { type: 'text', text: 'hi2' } });
      store.finishStream('m');
      store.startStream('m');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
