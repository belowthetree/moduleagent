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
}

export interface AgentLoopConfig {
  kernelConfig: KernelConfig;
  systemPrompt: string;
  workspaceRoot: string;
  tools: Tool[];
  maxToolRounds?: number;
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
