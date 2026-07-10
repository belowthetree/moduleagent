// ---------------------------------------------------------------------------
// AgentLauncher.ts — Agent 内核启动器
// 使用 AgentKernel（进程内 LLM 代理）启动 agent
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
}

export class AgentLauncher {
  async launch(
    config: AgentConfig,
    name: string,
    cwd: string,
    systemPrompt: string,
    logger?: Logger,
    kernelOptions?: {
      mcpGraphFile?: string;
      mcpBackendUrl?: string;
      moduleName?: string;
      maxToolRounds?: number;
      sandbox?: AgentSandbox;
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
      },
      workspaceRoot: normalizedCwd,
      systemPrompt,
      sandbox: kernelOptions?.sandbox,
      maxToolRounds: kernelOptions?.maxToolRounds ?? 15,
      logger: log,
    };

    if (kernelOptions?.moduleName) {
      kernelConfig.mcpBridge = {
        workspaceRoot: normalizedCwd,
        moduleName: kernelOptions.moduleName,
        graphFilePath: kernelOptions.mcpGraphFile,
        backendUrl: kernelOptions.mcpBackendUrl,
      };
    }

    const kernel = new AgentKernel(kernelConfig);
    log.info(`[Kernel:${name}] initialized with model=${model}, provider=${provider}`);
    return kernel;
  }

  // 兼容旧 API 的别名
  async launchKernel(
    config: AgentConfig,
    name: string,
    cwd: string,
    systemPrompt: string,
    logger?: Logger,
    kernelOptions?: {
      mcpGraphFile?: string;
      mcpBackendUrl?: string;
      moduleName?: string;
      maxToolRounds?: number;
      sandbox?: AgentSandbox;
    },
  ): Promise<AgentKernel> {
    return this.launch(config, name, cwd, systemPrompt, logger, kernelOptions);
  }
}
