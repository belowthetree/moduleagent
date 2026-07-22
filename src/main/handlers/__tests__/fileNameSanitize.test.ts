// ---------------------------------------------------------------------------
// main/handlers/__tests__/fileNameSanitize.test.ts — sanitizeFileName 单元测试
// 验证路径穿越防护：分隔符/非法字符清洗、裸 '..' 与空名称拒绝
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from '../fileNameSanitize.js';

describe('sanitizeFileName', () => {
  it('保留正常文件名（含中文与空格）', () => {
    expect(sanitizeFileName('module.md')).toBe('module.md');
    expect(sanitizeFileName('中文 名称.md')).toBe('中文 名称.md');
    expect(sanitizeFileName('foo..bar.md')).toBe('foo..bar.md');
  });

  it('路径分隔符与 Windows 非法字符替换为下划线', () => {
    expect(sanitizeFileName('a/b.md')).toBe('a_b.md');
    expect(sanitizeFileName('a\\b.md')).toBe('a_b.md');
    expect(sanitizeFileName('a:b*c?d<e>f|g.md')).toBe('a_b_c_d_e_f_g.md');
  });

  it('../ 穿越输入清洗后不再含路径分隔符', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('..\\..\\win.ini')).toBe('.._.._win.ini');
    // 清洗结果不含分隔符，path.join 后仍停留在目标目录内
    expect(sanitizeFileName('../../etc/passwd')).not.toMatch(/[/\\]/);
  });

  it('拒绝裸 .. 、 . 与空名称', () => {
    expect(() => sanitizeFileName('..')).toThrow('非法文件名');
    expect(() => sanitizeFileName('.')).toThrow('非法文件名');
    expect(() => sanitizeFileName('')).toThrow('非法文件名');
  });
});
