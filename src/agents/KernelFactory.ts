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

    const apiKey = config.apiKey
      || process.env['ANTHROPIC_API_KEY']
      || process.env['OPENAI_API_KEY']
      || process.env['DASHSCOPE_API_KEY']
      || process.env['DEEPSEEK_API_KEY']
      || '';

    const baseUrl = config.baseUrl
      || process.env['API_BASE_URL']
      || 'https://api.anthropic.com';

    const model = config.model || 'claude-sonnet-4-20250514';
    const provider = config.provider || 'anthropic';

    const kernelConfig: KernelOptions = {
      name,
      config: {
        provider,
        apiKey,
        baseUrl,
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
