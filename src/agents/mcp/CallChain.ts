// ---------------------------------------------------------------------------
// agents/mcp/CallChain.ts — 跨模块调用链追踪
//
// 基于 AsyncLocalStorage 在因果嵌套的 await 链上自动传播调用链，
// 模型侧零感知。用于 routeCall 的环检测与深度限制。
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CallChainStore {
  /** 从根到当前调用方的模块链，如 ['root', 'auth'] */
  chain: string[];
}

const storage = new AsyncLocalStorage<CallChainStore>();

/** 获取当前异步上下文中的调用链（无上下文时返回空链） */
export function currentChain(): string[] {
  return storage.getStore()?.chain ?? [];
}

/** 在指定调用链上下文中执行函数 */
export function runWithChain<T>(chain: string[], fn: () => T): T {
  return storage.run({ chain }, fn);
}
