// ---------------------------------------------------------------------------
// core/__tests__/PathUtils.test.ts — 路径工具函数单元测试
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { normalizeCodeSourcePath } from '../PathUtils.js';
import path from 'path';

describe('PathUtils', () => {
  describe('normalizeCodeSourcePath', () => {
    it('returns empty string as-is', () => {
      expect(normalizeCodeSourcePath('')).toBe('');
    });

    it('resolves relative paths', () => {
      const result = normalizeCodeSourcePath('src/module.md');
      expect(result).toBe(path.resolve('src/module.md'));
    });

    if (process.platform !== 'win32') {
      it('resolves absolute Unix paths', () => {
        const result = normalizeCodeSourcePath('/home/user/project');
        expect(result).toBe('/home/user/project');
      });
    }

    if (process.platform !== 'win32') {
      it('converts Windows drive-letter paths to /mnt/ format on non-Windows', () => {
        const result = normalizeCodeSourcePath('E:\\foo\\bar');
        expect(result).toBe('/mnt/e/foo/bar');
      });

      it('converts lowercase drive letter paths', () => {
        const result = normalizeCodeSourcePath('c:\\Users\\test');
        expect(result).toBe('/mnt/c/Users/test');
      });

      it('converts forward-slash Windows paths', () => {
        const result = normalizeCodeSourcePath('D:/projects/my-app');
        expect(result).toBe('/mnt/d/projects/my-app');
      });
    }
  });
});
