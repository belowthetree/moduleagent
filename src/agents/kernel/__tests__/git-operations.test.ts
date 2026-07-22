// ---------------------------------------------------------------------------
// agents/kernel/__tests__/git-operations.test.ts — git_operations 参数校验测试
// 重点覆盖 args flag 白名单与 pathspec 校验（--output 等危险 flag 被拒绝）
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { AgentSandbox } from '../Sandbox.js';
import { createGitOperationsTool } from '../tools/git-operations.js';

describe('git_operations args 校验', () => {
  let tmpDir: string;
  let tool: ReturnType<typeof createGitOperationsTool>;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ops-test-'));
    const sandbox = new AgentSandbox({ allowed: [tmpDir], excluded: [] });
    tool = createGitOperationsTool(sandbox);
  });

  afterAll(() => {
    fs.removeSync(tmpDir);
  });

  it('拒绝 git log --output=<绝对路径>（可绕过写沙箱）', async () => {
    const result = await tool.execute({ operation: 'log', args: ['--output=C:/evil.txt'] });
    expect(result.metadata?.code).toBe('invalid_args');
    expect(result.content).toContain('--output');
  });

  it('拒绝未在白名单内的危险 flag（--exec、-c、--git-dir）', async () => {
    for (const args of [['--exec=touch x'], ['-c', 'alias.x=!calc'], ['--git-dir=/tmp/x']]) {
      const result = await tool.execute({ operation: 'log', args });
      expect(result.metadata?.code).toBe('invalid_args');
    }
  });

  it('拒绝绝对路径 pathspec', async () => {
    const winAbs = await tool.execute({ operation: 'log', args: ['C:/Windows/System32'] });
    expect(winAbs.metadata?.code).toBe('invalid_args');
    const unixAbs = await tool.execute({ operation: 'diff', args: ['/etc/passwd'] });
    expect(unixAbs.metadata?.code).toBe('invalid_args');
  });

  it('拒绝包含 ".." 的 pathspec', async () => {
    const result = await tool.execute({ operation: 'checkout', args: ['../../outside'] });
    expect(result.metadata?.code).toBe('invalid_args');
  });

  it('放行白名单内的安全 flag（校验通过后由 git 自身报错，而非 invalid_args）', async () => {
    const result = await tool.execute({ operation: 'log', args: ['--oneline', '--max-count=5', '--graph'] });
    expect(result.metadata?.code).not.toBe('invalid_args');
    expect(result.metadata?.operation).toBe('log');
  });

  it('放行 "--" 分隔符及其后的相对 pathspec', async () => {
    const result = await tool.execute({ operation: 'log', args: ['--oneline', '--', 'src/index.ts'] });
    expect(result.metadata?.code).not.toBe('invalid_args');
  });

  it('"--" 之后仍拒绝绝对路径', async () => {
    const result = await tool.execute({ operation: 'checkout', args: ['--', 'C:/evil.txt'] });
    expect(result.metadata?.code).toBe('invalid_args');
  });

  it('拒绝不支持的 operation（原有行为不变）', async () => {
    const result = await tool.execute({ operation: 'push', args: [] });
    expect(result.metadata?.code).toBe('invalid_operation');
  });
});
