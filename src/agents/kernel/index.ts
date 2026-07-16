// ---------------------------------------------------------------------------
// agents/kernel/index.ts — 公共导出
// ---------------------------------------------------------------------------

export { AgentKernel } from './AgentKernel.js';
export type { KernelOptions, KernelNotification, NotificationCallback, KernelSendResult } from './AgentKernel.js';

export { AgentLoop } from './AgentLoop.js';
export type { LoopEvents, SendResult } from './AgentLoop.js';

export { AgentSandbox } from './Sandbox.js';
export type { VisibilityConfig } from './Sandbox.js';

export { resolveLanguageModel } from './ProviderResolver.js';
export type { ProviderType, ResolvedProvider } from './ProviderResolver.js';
export { convertToolToAISDK, convertToolDefinitionToAISDK, convertToolsToAISDK } from './ToolAdapter.js';
export { ToolRegistry } from './ToolRegistry.js';
export { TokenEstimator } from '../../core/TokenEstimator.js';
export { HistoryTruncator, DEFAULT_TRUNCATION_CONFIG } from './HistoryTruncator.js';
export type { TruncationConfig } from './HistoryTruncator.js';
export { ModelRouter } from './ModelRouter.js';
export { ContextCompactor, DEFAULT_COMPACTION_CONFIG } from './ContextCompactor.js';
export type { CompactionConfig } from './ContextCompactor.js';
export { StormBreaker } from './StormBreaker.js';
export { ToolOutputTruncator, TOOL_TRUNCATION_RULES } from './ToolOutputTruncator.js';
export { createModuleContextTools } from './tools/module-context.js';
export { createKernelToolRegistry, createRootKernelToolRegistry, createBuiltinTools, createModuleFileTools } from './tools/index.js';

export { buildSystemPrompt, loadPromptTemplates } from '../prompts/system.js';
export type { SystemPromptContext } from '../prompts/system.js';
export { loadModuleBody, loadPatternsContent, loadExperienceContent } from '../prompts/context.js';

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
