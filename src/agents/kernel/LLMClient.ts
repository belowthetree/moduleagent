// ---------------------------------------------------------------------------
// agents/kernel/LLMClient.ts — 兼容 OpenAI 的 LLM API 客户端
// 支持流式（SSE）与非流式聊天补全
// ---------------------------------------------------------------------------

import type { ChatMessage, ChatResponse, KernelConfig, StreamChunk, ToolDefinition } from './types.js';

export class LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: KernelConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.7;
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      stream: false,
      temperature: this.temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM API 错误 (${resp.status}): ${errText.slice(0, 500)}`);
    }

    const json = (await resp.json()) as ChatResponse;

    if (!json.choices || json.choices.length === 0) {
      throw new Error('LLM API 返回空结果');
    }

    return json;
  }

  async *chatStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: this.maxTokens,
      stream: true,
      temperature: this.temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`LLM API 错误 (${resp.status}): ${errText.slice(0, 500)}`);
    }

    if (!resp.body) {
      throw new Error('LLM API 流式响应体为空');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const chunk = JSON.parse(data) as StreamChunk;
            yield chunk;
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
