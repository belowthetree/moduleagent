// ---------------------------------------------------------------------------
// core/__tests__/ModuleScanner.test.ts — 模块扫描器单元测试
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleScanner } from '../ModuleScanner.js';

describe('ModuleScanner', () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createProject(structure: Record<string, string | null>): string {
    const root = mkdtempSync(join(tmpdir(), 'pi-module-scan-'));
    tempDirs.push(root);

    for (const [relPath, content] of Object.entries(structure)) {
      const fullPath = join(root, relPath);
      if (content === null) {
        mkdirSync(fullPath, { recursive: true });
      } else {
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content, 'utf-8');
      }
    }

    return root;
  }

  describe('scan', () => {
    it('throws for non-existent project root', async () => {
      await expect(
        ModuleScanner.scan({ projectRoot: '/non/existent/path' }),
      ).rejects.toThrow('does not exist');
    });

    it('returns empty array for project with no module.md files', async () => {
      const root = createProject({
        'src/foo.ts': 'const x = 1;',
        'src/bar.ts': null,
        'README.md': '# Project',
      });

      const result = await ModuleScanner.scan({ projectRoot: root });
      expect(result).toEqual([]);
    });

    it('finds root module.md', async () => {
      const root = createProject({
        'module.md': '---\nname: my-project\ndescription: Root\n---\n\n# My Project',
        'src/lib.ts': 'export const x = 1;',
      });

      const result = await ModuleScanner.scan({ projectRoot: root });

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('my-project');
      expect(result[0]?.relativePath).toBe('.');
      expect(result[0]?.rootPath).toBe(root);
    });

    it('finds nested module.md files', async () => {
      const root = createProject({
        'module.md': '---\nname: root\ndescription: Root\n---\n\n# Root',
        'packages/auth/module.md': '---\nname: auth\ndescription: Auth\n---\n\n# Auth',
        'packages/payments/module.md': '---\nname: payments\ndescription: Pay\n---\n\n# Pay',
        'packages/auth/src/index.ts': null,
        'packages/payments/src/index.ts': null,
      });

      const result = await ModuleScanner.scan({ projectRoot: root });

      expect(result).toHaveLength(3);
      // 模块标识使用相对路径（跨模块解析、module.md 引用均以相对路径为准），
      // 根模块（relativePath='.'）使用 frontmatter name
      const names = result.map((d) => d.name).sort();
      expect(names).toEqual(['packages/auth', 'packages/payments', 'root']);
    });

    it('normalizes path separators in module names (Windows backslash safe)', async () => {
      const root = createProject({
        'module.md': '---\nname: root\ndescription: Root\n---\n\n# Root',
        'packages/auth/module.md': '---\nname: auth\ndescription: Auth\n---\n\n# Auth',
        'deeply/nested/mod/module.md': '---\nname: mod\ndescription: Mod\n---\n\n# Mod',
      });

      const result = await ModuleScanner.scan({ projectRoot: root });

      // 任何平台（含 Windows）模块名与 relativePath 都不得含反斜杠
      for (const d of result) {
        expect(d.name).not.toContain('\\');
        expect(d.relativePath).not.toContain('\\');
      }
      const names = result.map((d) => d.name).sort();
      expect(names).toEqual(['deeply/nested/mod', 'packages/auth', 'root']);
    });

    it('excludes builtin-excluded directories', async () => {
      const root = createProject({
        'module.md': '---\nname: root\ndescription: Root\n---\n\n# Root',
        'node_modules/dep/module.md': '---\nname: dep\ndescription: Dep\n---\n\n# Dep',
        '.git/hooks/module.md': '---\nname: hook\ndescription: Hook\n---\n\n# Hook',
      });

      const result = await ModuleScanner.scan({ projectRoot: root });

      // Only root module should be found; node_modules and .git are excluded
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('root');
    });

    it('respects extraExclude patterns', async () => {
      const root = createProject({
        'module.md': '---\nname: root\ndescription: Root\n---\n\n# Root',
        'temp/module.md': '---\nname: temp\ndescription: Temp\n---\n\n# Temp',
        'generated/module.md': '---\nname: generated\ndescription: Gen\n---\n\n# Gen',
      });

      const result = await ModuleScanner.scan({
        projectRoot: root,
        extraExclude: ['temp', 'generated'],
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('root');
    });

    it('creates experience.md and patterns.md for found modules', async () => {
      const root = createProject({
        'module.md': '---\nname: root\ndescription: Root\n---\n\n# Root',
        'src/sub/module.md': '---\nname: sub\ndescription: Sub\n---\n\n# Sub',
      });

      await ModuleScanner.scan({ projectRoot: root });

      // experience.md should be created for both modules
      const fs = await import('fs-extra');
      expect(await fs.pathExists(join(root, 'experience.md'))).toBe(true);
      expect(await fs.pathExists(join(root, 'patterns.md'))).toBe(true);
      expect(await fs.pathExists(join(root, 'src/sub', 'experience.md'))).toBe(true);
      expect(await fs.pathExists(join(root, 'src/sub', 'patterns.md'))).toBe(true);
    });
  });
});
