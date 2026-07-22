// ---------------------------------------------------------------------------
// agents/lifecycle/__tests__/RoleAgentManager.test.ts — 角色配置透传单测
// 验证 resolveRoleConfig 把 RoleConfig.agents.default 的 LLM 字段完整透传到 AgentConfig
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { RoleAgentManager } from '../RoleAgentManager.js';
import { KernelFactory } from '../../KernelFactory.js';
import type { RoleConfig } from '../../../config/defaults.js';

function makeManager(): RoleAgentManager {
  return new RoleAgentManager({
    launcher: new KernelFactory(),
    basePath: '/tmp',
    projectPath: '/tmp',
    workspaceRoot: '/tmp',
  });
}

function makeRole(overrides: Partial<RoleConfig['agents']['default']> = {}): RoleConfig {
  return {
    name: '测试角色',
    description: '',
    visibleModulePaths: [],
    agents: {
      default: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://example.com/v1',
        model: 'gpt-4o',
        fastModel: 'gpt-4o-mini',
        contextWindow: 128000,
        ...overrides,
      },
    },
  };
}

describe('RoleAgentManager.resolveRoleConfig', () => {
  it('透传 provider/apiKey/baseUrl/model/fastModel/contextWindow', () => {
    const manager = makeManager();
    const config = manager.resolveRoleConfig(makeRole());

    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-test');
    expect(config.baseUrl).toBe('https://example.com/v1');
    expect(config.model).toBe('gpt-4o');
    expect(config.fastModel).toBe('gpt-4o-mini');
    expect(config.contextWindow).toBe(128000);
  });

  it('可选字段缺省时为 undefined（不伪造 command/args）', () => {
    const manager = makeManager();
    const role = makeRole({ provider: undefined, fastModel: undefined, contextWindow: undefined });
    const config = manager.resolveRoleConfig(role);

    expect(config.provider).toBeUndefined();
    expect(config.fastModel).toBeUndefined();
    expect(config.contextWindow).toBeUndefined();
    expect(config.command).toBeUndefined();
    expect(config.args).toBeUndefined();
  });
});
