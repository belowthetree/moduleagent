// ---------------------------------------------------------------------------
// agents/kernel/__tests__/Sandbox.test.ts — 沙箱路径校验单元测试
// 重点覆盖 symlink / junction 逃逸防护（realpath 校验）
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { AgentSandbox } from '../Sandbox.js';
import { createFileReadTool } from '../tools/file-read.js';

describe('AgentSandbox', () => {
  let tmpDir: string;
  let workspace: string;
  let outside: string;
  let sandbox: AgentSandbox;
  let symlinkOk = false;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
    workspace = path.join(tmpDir, 'workspace');
    outside = path.join(tmpDir, 'outside');
    fs.ensureDirSync(workspace);
    fs.ensureDirSync(outside);
    fs.writeFileSync(path.join(workspace, 'inside.txt'), 'inside-content', 'utf-8');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret-content', 'utf-8');

    sandbox = new AgentSandbox({ allowed: [workspace], excluded: [] });

    // 在工作区内创建指向外部的目录链接（junction 不需要管理员权限）
    try {
      fs.symlinkSync(outside, path.join(workspace, 'escape-link'),
        process.platform === 'win32' ? 'junction' : 'dir');
      // 指向工作区内部的合法链接
      fs.symlinkSync(workspace, path.join(workspace, 'inner-link'),
        process.platform === 'win32' ? 'junction' : 'dir');
      symlinkOk = true;
    } catch {
      symlinkOk = false; // 无权限创建链接时跳过相关用例
    }
  });

  afterAll(() => {
    fs.removeSync(tmpDir);
  });

  it('允许读取工作区内的普通文件', async () => {
    await expect(sandbox.readFile('inside.txt')).resolves.toBe('inside-content');
  });

  it('拒绝读取工作区外的绝对路径', () => {
    expect(() => sandbox.resolvePath(path.join(outside, 'secret.txt'))).toThrow(/访问被拒绝/);
  });

  it('拒绝 ".." 词法逃逸', () => {
    expect(() => sandbox.resolvePath('../outside/secret.txt')).toThrow(/访问被拒绝/);
  });

  it('允许写入工作区内尚不存在的新文件', async () => {
    await expect(sandbox.writeFile('new-dir/new-file.txt', 'x')).resolves.toBeUndefined();
    expect(fs.readFileSync(path.join(workspace, 'new-dir', 'new-file.txt'), 'utf-8')).toBe('x');
  });

  it('拒绝通过 symlink/junction 逃逸读取外部文件', async (ctx) => {
    if (!symlinkOk) return ctx.skip();
    const fileRead = createFileReadTool(sandbox);
    await expect(fileRead.execute({ filePath: 'escape-link/secret.txt' }))
      .rejects.toThrow(/访问被拒绝/);
  });

  it('拒绝通过 symlink/junction 逃逸写入外部文件', async (ctx) => {
    if (!symlinkOk) return ctx.skip();
    await expect(sandbox.writeFile('escape-link/evil.txt', 'evil')).rejects.toThrow(/访问被拒绝/);
    expect(fs.existsSync(path.join(outside, 'evil.txt'))).toBe(false);
  });

  it('指向工作区内部的链接仍然可用', async (ctx) => {
    if (!symlinkOk) return ctx.skip();
    await expect(sandbox.readFile('inner-link/inside.txt')).resolves.toBe('inside-content');
  });

  it('isPathVisible 对逃逸链接返回 false', (ctx) => {
    if (!symlinkOk) return ctx.skip();
    expect(sandbox.isPathVisible('escape-link/secret.txt')).toBe(false);
    expect(sandbox.isPathVisible('inside.txt')).toBe(true);
  });

  it('excluded 子模块目录仍被拒绝', () => {
    const sub = path.join(workspace, 'submodule');
    fs.ensureDirSync(sub);
    fs.writeFileSync(path.join(sub, 'mod.txt'), 'mod', 'utf-8');
    const s = new AgentSandbox({ allowed: [workspace], excluded: [sub] });
    expect(() => s.resolvePath('submodule/mod.txt')).toThrow(/子模块目录/);
  });
});
