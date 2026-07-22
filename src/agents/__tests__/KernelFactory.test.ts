// ---------------------------------------------------------------------------
// agents/__tests__/KernelFactory.test.ts — env→provider 推断单测
// 验证 resolveConnectionConfig 按取到的 env key 推断 provider、baseUrl 默认行为
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { resolveConnectionConfig } from '../KernelFactory.js';

describe('resolveConnectionConfig', () => {
  it('显式配置优先：config.apiKey/provider/baseUrl 不被 env 覆盖', () => {
    const resolved = resolveConnectionConfig(
      { apiKey: 'k', provider: 'openai', baseUrl: 'https://x/v1', model: 'm' },
      { ANTHROPIC_API_KEY: 'env-key' },
    );
    expect(resolved).toEqual({
      provider: 'openai',
      apiKey: 'k',
      baseUrl: 'https://x/v1',
      model: 'm',
    });
  });

  it('ANTHROPIC_API_KEY → provider=anthropic，默认 baseUrl', () => {
    const resolved = resolveConnectionConfig({}, { ANTHROPIC_API_KEY: 'ak' });
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.apiKey).toBe('ak');
    expect(resolved.baseUrl).toBe('https://api.anthropic.com');
  });

  it('OPENAI_API_KEY → 推断 provider=openai（不再错配 anthropic），不设 anthropic baseUrl', () => {
    const resolved = resolveConnectionConfig({}, { OPENAI_API_KEY: 'ok' });
    expect(resolved.provider).toBe('openai');
    expect(resolved.apiKey).toBe('ok');
    expect(resolved.baseUrl).toBeUndefined();
  });

  it('GOOGLE_API_KEY → 推断 provider=google', () => {
    const resolved = resolveConnectionConfig({}, { GOOGLE_API_KEY: 'gk' });
    expect(resolved.provider).toBe('google');
    expect(resolved.apiKey).toBe('gk');
  });

  it('DEEPSEEK_API_KEY → 推断 provider=deepseek', () => {
    const resolved = resolveConnectionConfig({}, { DEEPSEEK_API_KEY: 'dk' });
    expect(resolved.provider).toBe('deepseek');
    expect(resolved.apiKey).toBe('dk');
  });

  it('DASHSCOPE_API_KEY → custom + dashscope 兼容端点', () => {
    const resolved = resolveConnectionConfig({}, { DASHSCOPE_API_KEY: 'qk' });
    expect(resolved.provider).toBe('custom');
    expect(resolved.apiKey).toBe('qk');
    expect(resolved.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('多个 env key 并存时按优先级取第一个', () => {
    const resolved = resolveConnectionConfig(
      {},
      { OPENAI_API_KEY: 'ok', DEEPSEEK_API_KEY: 'dk' },
    );
    expect(resolved.provider).toBe('openai');
    expect(resolved.apiKey).toBe('ok');
  });

  it('无任何 key：provider 回退 anthropic，apiKey 为空', () => {
    const resolved = resolveConnectionConfig({}, {});
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.apiKey).toBe('');
  });

  it('显式 provider 时即使 key 来自 env 也不覆盖 provider', () => {
    const resolved = resolveConnectionConfig(
      { provider: 'deepseek' },
      { OPENAI_API_KEY: 'ok' },
    );
    expect(resolved.provider).toBe('deepseek');
    expect(resolved.apiKey).toBe('ok');
  });

  it('API_BASE_URL env 作为 baseUrl 兜底', () => {
    const resolved = resolveConnectionConfig(
      {},
      { OPENAI_API_KEY: 'ok', API_BASE_URL: 'https://proxy/v1' },
    );
    expect(resolved.baseUrl).toBe('https://proxy/v1');
  });
});
