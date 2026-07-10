// ---------------------------------------------------------------------------
// agents/kernel/index.ts — 公共导出
// ---------------------------------------------------------------------------

export { AgentKernel } from './AgentKernel.js';
export type { KernelOptions, KernelNotification, NotificationCallback, KernelSendResult } from './AgentKernel.js';

export { AgentLoop } from './AgentLoop.js';
export type { LoopEvents } from './AgentLoop.js';

export { AgentSandbox } from './sandbox.js';
export type { VisibilityConfig } from './sandbox.js';

export { resolveLanguageModel } from './ProviderResolver.js';
export type { ProviderType, ResolvedProvider } from './ProviderResolver.js';
export { convertToolToAISDK, convertToolDefinitionToAISDK, convertToolsToAISDK } from './ToolConverter.js';
export { ToolRegistry } from './ToolRegistry.js';
export { createKernelToolRegistry, createBuiltinTools } from './tools/index.js';

export { buildSystemPrompt, loadPromptTemplates } from './prompts/system.js';
export type { SystemPromptContext } from './prompts/system.js';
export { loadModuleBody, loadPatternsContent, loadExperienceContent } from './prompts/context.js';

export type {
  Tool,
  ToolDefinition,
  ToolOutput,
  ToolInputSchema,
  ToolCall,
  ChatMessage,
  ChatResponse,
  StreamChunk,
  KernelConfig,
  AgentLoopConfig,
  PromptBlock,
  AgentResult,
  LoopPhase,
  LoopEvent,
} from './types.js';
