// ---------------------------------------------------------------------------
// agents/kernel/types.ts — 代理内核核心类型定义
// 定义 Tool、ToolRegistry、AgentLoop、KernelConfig 等接口
// ---------------------------------------------------------------------------

export interface ToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: Record<string, unknown>): Promise<ToolOutput>;
}

export interface ToolOutput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolInputSchema;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface KernelConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  fastModel?: string;
  allowStreaming?: boolean;
  /** 上下文窗口总 token 数（用于截断判断，默认 128000） */
  contextWindow?: number;
}

export interface VisibilityConfig {
  allowed: string[];
  excluded: string[];
}

export interface AgentLoopConfig {
  kernelConfig: KernelConfig;
  systemPrompt: string;
  workspaceRoot: string;
  tools: Tool[];
  maxToolRounds?: number;
  /** 上下文截断配置（默认使用 DEFAULT_TRUNCATION_CONFIG） */
  truncation?: {
    contextWindow?: number;
    truncateRatio?: number;
    tailTokenBudget?: number;
    minKeepMessages?: number;
    /** 旧工具结果 snip 触发比例（默认 0.6） */
    snipRatio?: number;
  };
  /** 在线压缩配置（默认关闭） */
  compaction?: {
    enabled?: boolean;
    compactRatio?: number;
    tailTokenBudget?: number;
    minIntervalMs?: number;
  };
  /** 被丢弃内容（snip/compact/truncate）的存档目录；缺省则不存档 */
  archiveDir?: string;
}

export interface PromptBlock {
  type: 'text';
  text: string;
}

export interface AgentResult {
  stopReason: string;
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export enum LoopPhase {
  Idle = 'idle',
  Thinking = 'thinking',
  ToolCall = 'tool_call',
  Streaming = 'streaming',
  Done = 'done',
  Error = 'error',
  Cancelled = 'cancelled',
}

export interface LoopEvent {
  phase: LoopPhase;
  data?: unknown;
}
