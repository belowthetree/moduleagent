// ---------------------------------------------------------------------------
// agents/kernel/ProviderResolver.ts — ai-sdk 提供商工厂
// 根据配置创建对应的 LanguageModelV1 实例
// ---------------------------------------------------------------------------

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { KernelConfig } from './types.js';

export type ProviderType = 'anthropic' | 'openai' | 'deepseek' | 'google' | 'custom';

export interface ResolvedProvider {
  model: LanguageModel;
  provider: ProviderType;
  modelName: string;
}

export function resolveLanguageModel(config: KernelConfig): ResolvedProvider {
  const apiKey = config.apiKey || '';
  const modelName = config.model || 'claude-sonnet-4-20250514';
  const provider = (config.provider as ProviderType) || 'anthropic';

  let languageModel: LanguageModel;

  switch (provider) {
    case 'anthropic':
      languageModel = createAnthropic({ apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) })(modelName);
      break;
    case 'openai':
      languageModel = createOpenAI({ apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) })(modelName);
      break;
    case 'deepseek':
      languageModel = createDeepSeek({ apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) })(modelName);
      break;
    case 'google':
      languageModel = createGoogleGenerativeAI({ apiKey, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}) })(modelName);
      break;
    case 'custom':
      languageModel = createOpenAI({
        apiKey,
        baseURL: config.baseUrl || 'https://api.openai.com/v1',
      })(modelName);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    model: languageModel,
    provider,
    modelName,
  };
}
