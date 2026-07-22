// ---------------------------------------------------------------------------
// McpBackend.ts — 跨模块通信路由器
// 进程内路由模块间调用（module_call / module_query），直接调用目标 Agent kernel
// ---------------------------------------------------------------------------

import type { PromptBlock } from '../kernel/types.js';
import { defaultLogger } from '../../core/Logger.js';
import type { Agent } from '../Agent.js';
import { currentChain, runWithChain } from './CallChain.js';

export interface CrossModuleLimits {
  /** 跨模块调用最大跳数（默认 3） */
  maxHops?: number;
  /** 跨模块调用超时 ms（默认 120000） */
  timeoutMs?: number;
}

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

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
  /**
   * 跨模块上下文直接落盘（不经过目标模块的活跃流累积器）。
   * routeCall 完成后调用，requestText/responseText 由 router 局部累积。
   */
  appendCrossContext?(moduleName: string, requestText: string, responseText: string): Promise<void> | void;
  getModuleList?(requestingModule: string): { name: string; description: string; path: string }[];
}

export type McpBackendCallbacks = CrossModuleRouterCallbacks;

export class CrossModuleRouter {
  private readonly maxHops: number;
  private readonly timeoutMs: number;
  /** 等待图：requester → targets（用于跨链死锁检测；同一 requester 可并行等待多个 target） */
  private pendingWaits = new Map<string, Set<string>>();

  constructor(
    private callbacks: CrossModuleRouterCallbacks,
    limits: CrossModuleLimits = {},
  ) {
    this.maxHops = limits.maxHops ?? DEFAULT_MAX_HOPS;
    this.timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  listModules(requestingModule: string): string {
    if (this.callbacks.getModuleList) {
      const modules = this.callbacks.getModuleList(requestingModule);
      const lines = ['模块名称即是 `.module-agent/module/` 下的目录路径（根模块的文档直接在该目录下）:'];
      lines.push('');
      for (const m of modules) {
        const docPath = m.path === '.' ? 'module.md (根目录)' : `${m.path}/module.md`;
        const parent = m.path === '.' ? '' :
          m.path.lastIndexOf('/') > 0
            ? ` — 父模块: ${m.path.substring(0, m.path.lastIndexOf('/'))}`
            : '';
        lines.push(`- **${m.name}** → ${docPath}${parent} — ${m.description}`);
      }
      return lines.join('\n');
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

    // ── 调用链治理：环检测 + 深度限制 ──
    const prevChain = currentChain();
    const baseChain =
      requestingModule && prevChain[prevChain.length - 1] !== requestingModule
        ? [...prevChain, requestingModule]
        : [...prevChain];

    if (baseChain.includes(targetModule)) {
      const cyclePath = [...baseChain, targetModule].join(' → ');
      this.log('warn', `cross-module: cycle rejected: ${cyclePath}`);
      return {
        success: false,
        error: `检测到循环调用（${cyclePath}），已拒绝。请直接基于已有信息作答，或改派其他模块。`,
      };
    }
    if (baseChain.length > this.maxHops) {
      const chainPath = baseChain.join(' → ');
      this.log('warn', `cross-module: max hops (${this.maxHops}) exceeded: ${chainPath} ↦ ${targetModule}`);
      return {
        success: false,
        error: `跨模块委派超过最大深度 ${this.maxHops}（当前链: ${chainPath}），已拒绝。请直接完成当前子任务。`,
      };
    }

    // ── 跨链死锁检测（wait-for 图） ──
    if (requestingModule && this._wouldDeadlock(requestingModule, targetModule)) {
      this.log('warn', `cross-module: deadlock rejected: ${requestingModule} → ${targetModule}`);
      return {
        success: false,
        error: `调用 ${targetModule} 将形成等待环（目标正在等待调用方），已拒绝。请直接基于已有信息作答。`,
      };
    }

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

    if (requestingModule) this._addWaitEdge(requestingModule, targetModule);

    // 超时与此控制器关联：触发超时即 abort，排队/在途的 send 随之取消
    const abort = new AbortController();

    try {
      // 注意：不再触碰目标模块的共享流累积器（startStream/finishStream），
      // 避免与用户正在进行的流式对话竞争；回复累积在局部 responseText，
      // 完成后经 appendCrossContext 直接落盘。
      this.callbacks.setAgentStatus?.(targetModule, 'streaming');
      const promptBlocks = this.callbacks.buildPromptBlocks(targetModule, promptText);

      // 走 Agent.send 队列（busy 时排队），并传播调用链上下文
      const sendPromise = runWithChain([...baseChain, targetModule], () =>
        entry.send(promptBlocks, { signal: abort.signal }),
      );
      const result = await this._withTimeout(sendPromise, targetModule, abort);
      const responseText = result.content || '';

      this.callbacks.setAgentStatus?.(targetModule, 'idle');

      const isQuery = !!query && !task;

      if (this.callbacks.appendCrossContext) {
        const requestText = `[跨模块请求 from ${requestingModule || '?'}]\n${taskContent}`;
        Promise.resolve(
          this.callbacks.appendCrossContext(targetModule, requestText, responseText),
        ).catch((err) => {
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
    } finally {
      if (requestingModule) this._removeWaitEdge(requestingModule, targetModule);
    }
  }

  /** 等待图加边：requester → target */
  private _addWaitEdge(requester: string, target: string): void {
    let edges = this.pendingWaits.get(requester);
    if (!edges) {
      edges = new Set();
      this.pendingWaits.set(requester, edges);
    }
    edges.add(target);
  }

  /** 等待图删边：仅移除 requester → target 这一条，保留并行的其他边 */
  private _removeWaitEdge(requester: string, target: string): void {
    const edges = this.pendingWaits.get(requester);
    if (!edges) return;
    edges.delete(target);
    if (edges.size === 0) this.pendingWaits.delete(requester);
  }

  /** 死锁检测：从 target 沿 wait-for 图传递遍历（BFS），若能回到 requester 则成环 */
  private _wouldDeadlock(requester: string, target: string): boolean {
    const seen = new Set<string>();
    const stack: string[] = [target];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === requester) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const edges = this.pendingWaits.get(cur);
      if (edges) {
        for (const next of edges) stack.push(next);
      }
    }
    return false;
  }

  private _withTimeout<T>(promise: Promise<T>, targetModule: string, abort: AbortController): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 先取消再 reject：排队中的 send 会被跳过，在途的 send 会被中止
        abort.abort();
        reject(
          new Error(
            `跨模块调用超时（${this.timeoutMs}ms）: ${targetModule} 未在限定时间内完成`,
          ),
        );
      }, this.timeoutMs);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
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
