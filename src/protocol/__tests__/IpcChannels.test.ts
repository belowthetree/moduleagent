// ---------------------------------------------------------------------------
// protocol/__tests__/IpcChannels.test.ts — IPC 通道名测试
// 验证通道名无重复
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { IpcChannel } from '../IpcChannels.js';

describe('IpcChannels', () => {
  it('has no duplicate channel names', () => {
    const allValues: string[] = [];
    for (const group of Object.values(IpcChannel)) {
      if (typeof group === 'object') {
        for (const channel of Object.values(group as Record<string, string>)) {
          allValues.push(channel);
        }
      }
    }
    const unique = new Set(allValues);
    expect(unique.size).toBe(allValues.length);
  });

  it('has agent channels defined', () => {
    expect(IpcChannel.Agent.Start).toBe('agent:start');
    expect(IpcChannel.Agent.Send).toBe('agent:send');
    expect(IpcChannel.Agent.Cancel).toBe('agent:cancel');
  });

  it('has project channels defined', () => {
    expect(IpcChannel.Project.Scan).toBe('project:scan');
    expect(IpcChannel.Project.GetTree).toBe('project:getTree');
  });

  it('has config channels defined', () => {
    expect(IpcChannel.Config.Save).toBe('config:save');
    expect(IpcChannel.Config.Get).toBe('config:get');
  });

  it('has context channels defined', () => {
    expect(IpcChannel.Context.Get).toBe('context:get');
    expect(IpcChannel.Context.Clear).toBe('context:clear');
  });
});
