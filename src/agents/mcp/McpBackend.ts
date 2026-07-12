// ---------------------------------------------------------------------------
// McpBackend.ts — 跨模块通信路由器
// 进程内路由模块间调用（module_call / module_query），直接调用目标 Agent kernel
// ---------------------------------------------------------------------------

import type { PromptBlock } from '../kernel/types.js';
import { defaultLogger } from '../../core/Logger.js';
import type { Agent } from '../Agent.js';
import type { ChatMsg } from '../../types/shared.js';

export interface CrossModuleRouterCallbacks {
  getAgentEntry(moduleName: string): Agent | undefined;
  startAgent(moduleName: string): Promise<boolean>;
  buildPromptBlocks(moduleName: string, userText: string): PromptBlock[];
  sendCrossContext?(
    source: string,
    target: string,
    direction: 'sent' | 'received',
    phase: 'request' | 'response',
    content: string,
  ): void;
  setAgentStatus?(moduleName: string, status: 'idle' | 'streaming' | 'error'): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  startStream?(moduleName: string): void;
  finishStream?(moduleName: string): { reply: string; thinking: string; tools: string; timeline?: unknown[] } | undefined;
  saveCrossContext?(moduleName: string, msgs: ChatMsg[]): Promise<void>;
  getModuleList?(requestingModule: string): { name: string; description: string; path: string }[];
}

export type McpBackendCallbacks = CrossModuleRouterCallbacks;

export class CrossModuleRouter {
  constructor(private callbacks: CrossModuleRouterCallbacks) {}

  listModules(requestingModule: string): string {
    if (this.callbacks.getModuleList) {
      const modules = this.callbacks.getModuleList(requestingModule);
      return modules
        .map((m) => `- **${m.name}**: ${m.description} (路径: ${m.path})`)
        .join('\n') || '无可用模块';
    }
    return '无可用模块';
  }

  async routeCall(params: {
    targetModule: string;
    requestingModule: string;
    task?: string;
    query?: string;
  }): Promise<{ success: boolean; result?: string; answer?: string; error?: string }> {
    const { targetModule, requestingModule, task, query } = params;

    let entry = this.callbacks.getAgentEntry(targetModule);
    if (!entry) {
      const started = await this.callbacks.startAgent(targetModule);
      if (!started) {
        return { success: false, error: `Cannot start agent for module: ${targetModule}` };
      }
      entry = this.callbacks.getAgentEntry(targetModule);
      if (!entry) {
        return { success: false, error: `Agent for module not available after start: ${targetModule}` };
      }
    }

    const promptText = task
      ? `[Cross-module request] ${task}`
      : `[Cross-module query] ${query}`;
    const taskContent = task || query || '';

    if (requestingModule && targetModule) {
      this.log('info', `cross-context: ${requestingModule} → ${targetModule} [request]: ${taskContent.slice(0, 80)}`);
      this.callbacks.sendCrossContext?.(
        requestingModule,
        targetModule,
        'sent',
        'request',
        taskContent,
      );
      this.callbacks.sendCrossContext?.(
        targetModule,
        requestingModule,
        'received',
        'request',
        taskContent,
      );
    }

    try {
      this.callbacks.startStream?.(targetModule);
      this.callbacks.setAgentStatus?.(targetModule, 'streaming');
      const promptBlocks = this.callbacks.buildPromptBlocks(targetModule, promptText);

      let responseText = '';
      const kernel = entry.kernel;
      if (kernel) {
        const result = await kernel.send(promptBlocks);
        responseText = result.content;
      } else {
        responseText = 'No kernel available';
      }

      this.callbacks.setAgentStatus?.(targetModule, 'idle');

      const isQuery = !!query && !task;

      const acc = this.callbacks.finishStream?.(targetModule);
      if (acc && this.callbacks.saveCrossContext) {
        const timeStr = new Date().toLocaleTimeString();
        const baseId = 'x' + Date.now().toString(36);
        const msgs: ChatMsg[] = [];

        msgs.push({
          id: baseId,
          role: 'user',
          content: `[跨模块请求 from ${requestingModule || '?'}]\n${taskContent}`,
          thinking: '',
          time: timeStr,
          status: 'sent',
          moduleName: targetModule,
          sessionId: entry.sessionId,
        });

        for (const ev of (acc.timeline || []) as any[]) {
          if (ev.type === 'tool_call' && ev.content) {
            msgs.push({
              id: `tool-${targetModule}-${ev.toolCallId || Math.random().toString(36).slice(2, 6)}`,
              role: 'system',
              content: ev.content,
              thinking: '',
              time: timeStr,
              status: 'sent',
              moduleName: targetModule,
            });
          }
        }

        msgs.push({
          id: baseId + 'r',
          role: 'agent',
          content: acc.reply || responseText,
          thinking: acc.thinking || '',
          timeline: [],
          time: timeStr,
          status: 'completed',
          moduleName: targetModule,
        });

        this.callbacks.saveCrossContext(targetModule, msgs).catch(err => {
          this.log('warn', `cross-context: save failed for [${targetModule}]: ${(err as Error).message}`);
        });
      }

      const crossResponseText = responseText || '(No text)';
      if (requestingModule && targetModule) {
        this.callbacks.sendCrossContext?.(
          targetModule,
          requestingModule,
          'sent',
          'response',
          crossResponseText.slice(0, 200),
        );
        this.callbacks.sendCrossContext?.(
          requestingModule,
          targetModule,
          'received',
          'response',
          crossResponseText.slice(0, 200),
        );
      }

      return {
        success: true,
        ...(isQuery
          ? { answer: responseText || 'Agent response' }
          : { result: responseText || 'Agent response' }),
      };
    } catch (err) {
      this.callbacks.setAgentStatus?.(targetModule, 'error');
      return { success: false, error: `Prompt failed: ${(err as Error).message}` };
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.callbacks.onLog) {
      this.callbacks.onLog(level, message);
    } else if (level === 'error') {
      defaultLogger.error(message);
    } else if (level === 'warn') {
      defaultLogger.warn(message);
    } else {
      defaultLogger.info(message);
    }
  }
}
