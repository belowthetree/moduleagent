// ---------------------------------------------------------------------------
// agents/kernel/__tests__/execute-command.test.ts — execute_command 环境变量测试
// 重点覆盖子进程 env 白名单（API key 类变量不泄漏）
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { AgentSandbox } from '../Sandbox.js';
import { buildSafeEnv, createExecuteCommandTool } from '../tools/execute-command.js';

describe('execute_command 环境变量白名单', () => {
  const TEST_KEY = 'TEST_SECRET_API_KEY_12345';
  const TEST_VALUE = 'sk-test-secret';

  beforeEach(() => {
    process.env[TEST_KEY] = TEST_VALUE;
  });

  afterEach(() => {
    delete process.env[TEST_KEY];
  });

  it('buildSafeEnv 不包含 API key 类变量，但保留 PATH 等必要项', () => {
    const env = buildSafeEnv();
    expect(env[TEST_KEY]).toBeUndefined();
    expect(Object.keys(env).some(k => k.toLowerCase() === 'path')).toBe(true);
  });

  it('子进程环境中看不到敏感变量', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-cmd-test-'));
    try {
      const sandbox = new AgentSandbox({ allowed: [tmpDir], excluded: [] });
      const tool = createExecuteCommandTool(sandbox);
      const echoCmd = process.platform === 'win32' ? `echo %${TEST_KEY}%` : `echo $${TEST_KEY}`;
      const result = await tool.execute({ command: echoCmd });
      expect(result.content).not.toContain(TEST_VALUE);
    } finally {
      fs.removeSync(tmpDir);
    }
  });

  it('工具描述不再声称"在沙箱内执行"', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-cmd-test-'));
    try {
      const sandbox = new AgentSandbox({ allowed: [tmpDir], excluded: [] });
      const tool = createExecuteCommandTool(sandbox);
      expect(tool.description).not.toContain('在沙箱内执行');
      expect(tool.description).toContain('工作目录限制在可见范围内');
    } finally {
      fs.removeSync(tmpDir);
    }
  });
});
