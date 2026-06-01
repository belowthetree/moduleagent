// ---------------------------------------------------------------------------
// core/__tests__/ModuleParser.test.ts — module.md 解析器单元测试
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleParser } from '../ModuleParser.js';

describe('ModuleParser', () => {
  const tempDirs: string[] = [];

  function tempFile(name: string, content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'pi-module-parser-'));
    tempDirs.push(dir);
    const filePath = join(dir, name);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('parseFile', () => {
    it('parses a minimal module.md with frontmatter', async () => {
      const filePath = tempFile('module.md', [
        '---',
        'name: auth',
        'description: Authentication module',
        '---',
        '',
        '# Auth Module',
        '',
        'This is the auth module.',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      expect(result.frontmatter.name).toBe('auth');
      expect(result.frontmatter.description).toBe('Authentication module');
      expect(result.body).toBe('# Auth Module\n\nThis is the auth module.');
    });

    it('parses subModules from frontmatter', async () => {
      const filePath = tempFile('module.md', [
        '---',
        'name: services',
        'description: Service layer',
        'submodules:',
        '  - name: api',
        '    path: api',
        '    description: API service',
        '  - name: db',
        '    path: database',
        '    description: Database layer',
        '---',
        '',
        '# Services',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      expect(result.subModules).toHaveLength(2);
      expect(result.subModules[0]?.name).toBe('api');
      expect(result.subModules[0]?.path).toBe('api');
      expect(result.subModules[1]?.name).toBe('db');
      expect(result.subModules[1]?.path).toBe('database');
    });

    it('falls back to body submodule parsing when frontmatter has no submodules', async () => {
      const filePath = tempFile('module.md', [
        '---',
        'name: root',
        'description: Root',
        '---',
        '',
        '## 子模块',
        '',
        '- `auth` - Authentication module',
        '- `payments/` - Payment processing',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      expect(result.subModules).toHaveLength(2);
      expect(result.subModules[0]?.name).toBe('auth');
      expect(result.subModules[1]?.name).toBe('payments');
    });

    it('extracts description from "模块说明" heading', async () => {
      const filePath = tempFile('module.md', [
        '---',
        'name: test',
        'description: FM desc',
        '---',
        '',
        '## 模块说明',
        '',
        'This is the body description.',
        '',
        '## 其他',
        '',
        'Other content.',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      expect(result.description).toBe('This is the body description.');
    });

    it('uses basename when name is missing in frontmatter', async () => {
      const filePath = tempFile('module.md', [
        '---',
        'description: No name field',
        '---',
        '',
        '# Content',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      // When no name in frontmatter, uses cwd basename
      expect(typeof result.frontmatter.name).toBe('string');
    });

    it('handles missing file gracefully', async () => {
      await expect(
        ModuleParser.parseFile('/non/existent/module.md'),
      ).rejects.toThrow();
    });

    it('handles module.md with no frontmatter', async () => {
      const filePath = tempFile('module.md', [
        '# Just Content',
        '',
        'No frontmatter here.',
      ].join('\n'));

      const result = await ModuleParser.parseFile(filePath);

      expect(result.body).toBe('# Just Content\n\nNo frontmatter here.');
      expect(result.subModules).toEqual([]);
    });
  });
});
