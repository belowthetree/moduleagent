// ---------------------------------------------------------------------------
// KernelFactory.ts — AgentKernel 工厂
// 使用 AgentKernel（进程内 LLM 代理）创建 agent 内核实例
// ---------------------------------------------------------------------------

import path from 'path';
import { AgentKernel, type KernelOptions, AgentSandbox } from './kernel/index.js';
import type { Logger } from '../core/Logger.js';
import { defaultLogger } from '../core/Logger.js';

export interface AgentConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  model?: string;
  defaultMode?: string;
  kernel?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  fastModel?: string;
  contextWindow?: number;
}

/** env 变量 → provider 推断表（按优先级顺序取第一个存在的 key） */
const ENV_KEY_PROVIDER: Array<{ env: string; provider: string; baseUrl?: string }> = [
  { env: 'ANTHROPIC_API_KEY', provider: 'anthropic' },
  { env: 'OPENAI_API_KEY', provider: 'openai' },
  { env: 'GOOGLE_API_KEY', provider: 'google' },
  { env: 'DEEPSEEK_API_KEY', provider: 'deepseek' },
  // DashScope 无专用 provider 分支，走 OpenAI 兼容端点（custom）
  { env: 'DASHSCOPE_API_KEY', provider: 'custom', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
];

export interface ResolvedConnection {
  provider: string;
  apiKey: string;
  baseUrl: string | undefined;
  model: string;
}

/**
 * 解析连接配置（纯函数，便于单测）：
 * - apiKey 未显式配置时按 env 推断，并据此推断 provider（避免拿着 OPENAI key 配 anthropic）
 * - baseUrl 默认值仅 anthropic / dashscope 推断场景设置，其余交给 ProviderResolver
 */
export function resolveConnectionConfig(
  config: AgentConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedConnection {
  let apiKey = config.apiKey || '';
  let inferred: { provider: string; baseUrl?: string } | null = null;

  if (!apiKey) {
    for (const candidate of ENV_KEY_PROVIDER) {
      const value = env[candidate.env];
      if (value) {
        apiKey = value;
        inferred = candidate;
        break;
      }
    }
  }

  const provider = config.provider || inferred?.provider || 'anthropic';

  let baseUrl = config.baseUrl || env['API_BASE_URL'];
  if (!baseUrl) {
    if (provider === 'anthropic') {
      baseUrl = 'https://api.anthropic.com';
    } else if (!config.provider && inferred?.baseUrl) {
      // 仅 env 推断场景（如 DASHSCOPE）补默认端点；显式 provider 时由 ProviderResolver 处理
      baseUrl = inferred.baseUrl;
    }
  }

  const model = config.model || 'claude-sonnet-4-20250514';

  return { provider, apiKey, baseUrl, model };
}

export class KernelFactory {
  async create(
    config: AgentConfig,
    name: string,
    cwd: string,
    systemPrompt: string,
    logger?: Logger,
    kernelOptions?: {
      crossModuleRouter?: import('./mcp/McpBackend.js').CrossModuleRouter;
      requestingModule?: string;
      maxToolRounds?: number;
      sandbox?: AgentSandbox;
      isRoot?: boolean;
      moduleDir?: string;
      truncation?: import('./kernel/types.js').AgentLoopConfig['truncation'];
      compaction?: import('./kernel/types.js').AgentLoopConfig['compaction'];
      archiveDir?: string;
    },
  ): Promise<AgentKernel> {
    const log = logger || defaultLogger;
    const normalizedCwd = cwd.replace(/\\/g, '/');

    const { provider, apiKey, baseUrl, model } = resolveConnectionConfig(config);

    const kernelConfig: KernelOptions = {
      name,
      config: {
        provider,
        apiKey,
        // KernelConfig.baseUrl 为必填 string：未设置时传空串（ProviderResolver 各分支按 falsy 跳过）
        baseUrl: baseUrl ?? '',
        model,
        maxTokens: config.maxTokens ?? 4096,
        temperature: 0.7,
        fastModel: config.fastModel,
        contextWindow: config.contextWindow,
      },
      workspaceRoot: normalizedCwd,
      systemPrompt,
      sandbox: kernelOptions?.sandbox,
      maxToolRounds: kernelOptions?.maxToolRounds ?? 15,
      logger: log,
      isRoot: kernelOptions?.isRoot,
      moduleDir: kernelOptions?.moduleDir,
      truncation: kernelOptions?.truncation,
      compaction: kernelOptions?.compaction,
      archiveDir: kernelOptions?.archiveDir,
    };

    if (kernelOptions?.crossModuleRouter) {
      kernelConfig.crossModuleRouter = kernelOptions.crossModuleRouter;
      kernelConfig.requestingModule = kernelOptions.requestingModule;
    }

    const kernel = new AgentKernel(kernelConfig);
    log.info(`[Kernel:${name}] initialized with model=${model}, provider=${provider}`);
    return kernel;
  }

}
