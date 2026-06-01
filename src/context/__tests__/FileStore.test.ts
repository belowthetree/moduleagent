// ---------------------------------------------------------------------------
// context/__tests__/FileStore.test.ts — FileStore 单元测试
// 测试 JSON 文件的读写、删除、列表功能
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../FileStore.js';
import type { ChatMsg } from '../ContextManager.js';

describe('FileStore', () => {
  const tempDirs: string[] = [];
  const stores: FileStore[] = [];

  function createStore(): FileStore {
    const dir = mkdtempSync(join(tmpdir(), 'pi-file-store-'));
    tempDirs.push(dir);
    const store = new FileStore(dir);
    stores.push(store);
    return store;
  }

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createMsg(id: string): ChatMsg {
    return {
      id,
      role: 'user',
      content: `content for ${id}`,
      thinking: '',
      time: '12:00',
      status: 'done',
      moduleName: 'test',
    };
  }

  describe('save and load', () => {
    it('round-trips messages', () => {
      const store = createStore();
      const msgs = [createMsg('a'), createMsg('b')];

      store.save('module-1', msgs);
      const loaded = store.load('module-1');

      expect(loaded).toHaveLength(2);
      expect(loaded[0]?.id).toBe('a');
      expect(loaded[1]?.content).toBe('content for b');
    });

    it('returns empty array for non-existent module', () => {
      const store = createStore();
      const loaded = store.load('non-existent');
      expect(loaded).toEqual([]);
    });

    it('overwrites existing messages for a module', () => {
      const store = createStore();
      store.save('mod', [createMsg('old')]);
      store.save('mod', [createMsg('new')]);

      const loaded = store.load('mod');
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.id).toBe('new');
    });
  });

  describe('remove', () => {
    it('removes saved messages for a module', () => {
      const store = createStore();
      store.save('mod', [createMsg('a')]);
      store.remove('mod');

      const loaded = store.load('mod');
      expect(loaded).toEqual([]);
    });

    it('does not throw when removing non-existent module', () => {
      const store = createStore();
      expect(() => store.remove('no-such')).not.toThrow();
    });
  });

  describe('list', () => {
    it('returns all module names with saved contexts', () => {
      const store = createStore();
      store.save('alpha', [createMsg('a')]);
      store.save('beta', [createMsg('b')]);

      const names = store.list();
      expect(names.sort()).toEqual(['alpha', 'beta']);
    });

    it('returns empty array for empty store', () => {
      const store = createStore();
      expect(store.list()).toEqual([]);
    });

    it('filters out non-JSON files', () => {
      const store = createStore();
      const fs = require('node:fs');
      const contextsDir = join(store['baseDir']);
      store.save('valid', [createMsg('a')]);
      // Write a non-JSON file to the contexts directory
      fs.mkdirSync(contextsDir, { recursive: true });
      fs.writeFileSync(join(contextsDir, 'readme.txt'), 'not json');

      const names = store.list();
      expect(names).toEqual(['valid']);
    });
  });

  describe('isolation', () => {
    it('isolates contexts between different store instances', () => {
      const storeA = createStore();
      const storeB = createStore();

      storeA.save('shared-name', [createMsg('from-a')]);
      storeB.save('shared-name', [createMsg('from-b')]);

      expect(storeA.load('shared-name')[0]?.content).toBe('content for from-a');
      expect(storeB.load('shared-name')[0]?.content).toBe('content for from-b');
    });
  });
});
