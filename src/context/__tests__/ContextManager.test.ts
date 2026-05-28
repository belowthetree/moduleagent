import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMsg, ContextStore } from '../ContextManager.js';
import { ContextManager } from '../ContextManager.js';

function createMsg(overrides: Partial<ChatMsg> = {}): ChatMsg {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hello',
    thinking: '',
    time: '12:00',
    status: 'done',
    moduleName: 'test-module',
    ...overrides,
  };
}

describe('ContextManager', () => {
  let store: ContextStore;
  let manager: ContextManager;

  beforeEach(() => {
    store = {
      load: vi.fn(() => []),
      save: vi.fn(),
      remove: vi.fn(),
      list: vi.fn(() => []),
    };
    manager = new ContextManager(store);
  });

  describe('getMessages', () => {
    it('loads from store on first call', () => {
      const msgs = [createMsg()];
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(msgs);

      const result = manager.getMessages('mod-a');
      expect(result).toBe(msgs);
      expect(store.load).toHaveBeenCalledWith('mod-a');
    });

    it('caches loaded messages and does not re-read', () => {
      const msgs = [createMsg()];
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(msgs);

      manager.getMessages('mod-a');
      manager.getMessages('mod-a');

      expect(store.load).toHaveBeenCalledTimes(1);
    });

    it('isolates messages between modules', () => {
      const msgsA = [createMsg({ moduleName: 'a' })];
      const msgsB = [createMsg({ moduleName: 'b' })];
      (store.load as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(msgsA)
        .mockReturnValueOnce(msgsB);

      const resultA = manager.getMessages('mod-a');
      const resultB = manager.getMessages('mod-b');

      expect(resultA).toBe(msgsA);
      expect(resultB).toBe(msgsB);
    });
  });

  describe('addMessage', () => {
    it('appends message and persists to store', () => {
      const msg = createMsg();
      manager.addMessage('mod-a', msg);

      expect(store.save).toHaveBeenCalledWith('mod-a', [msg]);
    });

    it('appends after existing messages', () => {
      const existing = [createMsg({ id: 'existing' })];
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(existing);

      const newMsg = createMsg({ id: 'new' });
      manager.addMessage('mod-a', newMsg);

      const saved = (store.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as ChatMsg[];
      expect(saved).toHaveLength(2);
      expect(saved[0]?.id).toBe('existing');
      expect(saved[1]?.id).toBe('new');
    });
  });

  describe('clearModule', () => {
    it('removes from cache and store', () => {
      const msgs = [createMsg()];
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue(msgs);
      manager.getMessages('mod-a');

      manager.clearModule('mod-a');

      expect(store.remove).toHaveBeenCalledWith('mod-a');
      // re-reading should trigger a fresh load
      (store.load as ReturnType<typeof vi.fn>).mockReturnValue([]);
      const afterClear = manager.getMessages('mod-a');
      expect(afterClear).toEqual([]);
      expect(store.load).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAll', () => {
    it('clears all modules from store', () => {
      (store.list as ReturnType<typeof vi.fn>).mockReturnValue(['a', 'b']);

      manager.clearAll();

      expect(store.remove).toHaveBeenCalledWith('a');
      expect(store.remove).toHaveBeenCalledWith('b');
    });
  });

  describe('getModules', () => {
    it('returns store list', () => {
      (store.list as ReturnType<typeof vi.fn>).mockReturnValue(['a', 'b']);

      const result = manager.getModules();
      expect(result).toEqual(['a', 'b']);
    });
  });
});
