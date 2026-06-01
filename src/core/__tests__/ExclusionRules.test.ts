// ---------------------------------------------------------------------------
// core/__tests__/ExclusionRules.test.ts — 排除规则单元测试
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { BUILTIN_EXCLUDED_DIRS, BUILTIN_EXCLUDED_FILES, isBuiltinExcluded } from '../ExclusionRules.js';

describe('ExclusionRules', () => {
  describe('BUILTIN_EXCLUDED_DIRS', () => {
    it('includes common build and dependency directories', () => {
      expect(BUILTIN_EXCLUDED_DIRS).toContain('node_modules');
      expect(BUILTIN_EXCLUDED_DIRS).toContain('.git');
      expect(BUILTIN_EXCLUDED_DIRS).toContain('dist');
      expect(BUILTIN_EXCLUDED_DIRS).toContain('build');
    });

    it('has no duplicates', () => {
      const unique = new Set(BUILTIN_EXCLUDED_DIRS);
      expect(unique.size).toBe(BUILTIN_EXCLUDED_DIRS.length);
    });
  });

  describe('BUILTIN_EXCLUDED_FILES', () => {
    it('includes common metadata files', () => {
      expect(BUILTIN_EXCLUDED_FILES).toContain('.DS_Store');
      expect(BUILTIN_EXCLUDED_FILES).toContain('.env');
    });
  });

  describe('isBuiltinExcluded', () => {
    it('returns true for excluded directories', () => {
      expect(isBuiltinExcluded('node_modules')).toBe(true);
      expect(isBuiltinExcluded('.git')).toBe(true);
      expect(isBuiltinExcluded('dist')).toBe(true);
    });

    it('returns true for excluded files', () => {
      expect(isBuiltinExcluded('.DS_Store')).toBe(true);
      expect(isBuiltinExcluded('Thumbs.db')).toBe(true);
    });

    it('returns false for normal directories and files', () => {
      expect(isBuiltinExcluded('src')).toBe(false);
      expect(isBuiltinExcluded('my-project')).toBe(false);
      expect(isBuiltinExcluded('README.md')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isBuiltinExcluded('')).toBe(false);
    });
  });
});
