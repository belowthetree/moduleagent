// ---------------------------------------------------------------------------
// agents/kernel/__tests__/ProviderResolver.test.ts — baseUrl 透传单测
// 验证内置 provider 分支在 config.baseUrl 非空时透传 baseURL 给 ai-sdk 工厂
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 捕获各工厂收到的 options
const captured: Record<string, any> = {};

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: any) => {
    captured['anthropic'] = opts;
    return (model: string) => ({ provider: 'anthropic', modelId: model });
  },
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (opts: any) => {
    captured['openai'] = opts;
    return (model: string) => ({ provider: 'openai', modelId: model });
  },
}));
vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: (opts: any) => {
    captured['deepseek'] = opts;
    return (model: string) => ({ provider: 'deepseek', modelId: model });
  },
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (opts: any) => {
    captured['google'] = opts;
    return (model: string) => ({ provider: 'google', modelId: model });
  },
}));

import { resolveLanguageModel } from '../ProviderResolver.js';
import type { KernelConfig } from '../types.js';

function makeConfig(overrides: Partial<KernelConfig>): KernelConfig {
  return {
    provider: 'anthropic',
    apiKey: 'k',
    baseUrl: '',
    model: 'm',
    ...overrides,
  } as KernelConfig;
}

describe('resolveLanguageModel baseUrl 透传', () => {
  beforeEach(() => {
    for (const k of Object.keys(captured)) delete captured[k];
  });

  it('anthropic：baseUrl 非空时透传 baseURL', () => {
    resolveLanguageModel(makeConfig({ provider: 'anthropic', baseUrl: 'https://proxy/a' }));
    expect(captured['anthropic']).toEqual({ apiKey: 'k', baseURL: 'https://proxy/a' });
  });

  it('openai：baseUrl 非空时透传 baseURL', () => {
    resolveLanguageModel(makeConfig({ provider: 'openai', baseUrl: 'https://proxy/o' }));
    expect(captured['openai']).toEqual({ apiKey: 'k', baseURL: 'https://proxy/o' });
  });

  it('deepseek：baseUrl 非空时透传 baseURL', () => {
    resolveLanguageModel(makeConfig({ provider: 'deepseek', baseUrl: 'https://proxy/d' }));
    expect(captured['deepseek']).toEqual({ apiKey: 'k', baseURL: 'https://proxy/d' });
  });

  it('google：baseUrl 非空时透传 baseURL', () => {
    resolveLanguageModel(makeConfig({ provider: 'google', baseUrl: 'https://proxy/g' }));
    expect(captured['google']).toEqual({ apiKey: 'k', baseURL: 'https://proxy/g' });
  });

  it('内置 provider：baseUrl 为空时不传 baseURL（用 SDK 默认端点）', () => {
    resolveLanguageModel(makeConfig({ provider: 'anthropic', baseUrl: '' }));
    expect(captured['anthropic']).toEqual({ apiKey: 'k' });
  });

  it('custom：baseUrl 为空时回退 OpenAI 官方端点', () => {
    resolveLanguageModel(makeConfig({ provider: 'custom', baseUrl: '' }));
    expect(captured['openai']).toEqual({ apiKey: 'k', baseURL: 'https://api.openai.com/v1' });
  });

  it('custom：baseUrl 非空时作为兼容端点', () => {
    resolveLanguageModel(makeConfig({ provider: 'custom', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }));
    expect(captured['openai']).toEqual({ apiKey: 'k', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
  });
});
