// ============================================================================
// 共享 Send 管道
//
// agent:send 和 role:send 的公共逻辑提取：
//   锁 → 启动 agent → 构建 prompt → 流积累 → 调用 agent → 保存上下文 → 返回
//
// 两个 handler 只需填充 SendParams（约 15 行）即可复用此管道。
// 差异点通过 postProcess 钩子处理（总结 + 工作区 diff 仅在 agent:send 触发）。
// ============================================================================

import { IpcChannel } from '../../protocol/IpcChannels.js';
import type { ChatMsg } from '../../types/shared.js';
import type { HandlerContext } from './HandlerContext.js';
import type { Agent } from '../../agents/Agent.js';
import type { ContentBlock } from '@agentclientprotocol/sdk';

// ── 参数接口 ──────────────────────────────────────────────────────────────

/** send pipeline 的参数化配置，agent:send 和 role:send 各自填充 */
export interface SendParams {
  /** 模块名或角色名（用于锁 key 和状态映射） */
  domainName: string;
  /** 用户输入文本 */
  userText: string;
  /** 上下文持久化 key — 模块直接使用模块名，角色使用 "workrole:rolename" */
  contextKey: string;
  /** ChatMsg ID 前缀 — 模块 'm'，角色 'r' */
  msgIdPrefix: string;
  /** 锁映射 — sendLock 或 roleSendLock */
  lockMap: Map<string, Promise<void>>;
  /** 异步解析/启动 agent，返回 Agent 实例 */
  resolveAgent: () => Promise<Agent>;
  /** 构建发送给 agent 的 prompt blocks */
  buildPrompt: () => ContentBlock[];
  /** 后处理钩子 — agent:send 用于触发总结 + 工作区 diff；role:send 传 undefined */
  postProcess?: (msgs: ChatMsg[], agent: Agent) => void;
}

// ── 管道执行 ──────────────────────────────────────────────────────────────

/**
 * 执行完整的 send pipeline：锁 → 启动 → prompt → 流 → 保存 → 返回。
 *
 * 调用方（agentHandlers / roleHandlers）只需：
 * 1. 填充 SendParams（约 12-15 行）
 * 2. 调用 `return executeSendPipeline(params, ctx)`
 *
 * @returns { result: { reply, thinking, tools, timeline, stopReason } } 或 { error }
 */
export async function executeSendPipeline(
  params: SendParams,
  ctx: HandlerContext,
): Promise<{ result?: { reply: string; thinking: string; tools: string; timeline?: unknown[]; stopReason?: string }; error?: string }> {
  // ── 锁：串行化同一 domain 的并发请求 ──
  const prevLock = params.lockMap.get(params.domainName);
  if (prevLock) { try { await prevLock; } catch { /* 继续 */ } }
  let resolveLock: () => void = () => {};
  params.lockMap.set(params.domainName, new Promise<void>(r => { resolveLock = r; }));

  try {
    // ── 1. 解析/启动 agent ──
    const agent = await params.resolveAgent();

    // ── 2. 标记流式状态 → IPC 通知渲染进程 ──
    ctx.agentStatus.set(params.domainName, 'streaming');
    ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: params.domainName, status: 'streaming' });

    // ── 3. 构建 prompt blocks ──
    const promptBlocks = params.buildPrompt();

    // ── 4. 开始流积累 ──
    ctx.stateManager?.startStream(params.contextKey);

    // ── 5. 调用 agent ──
    ctx.logger.info(`send [${params.domainName}] len=${params.userText.length} blocks=${promptBlocks.length}`);
    const result = await agent.connection.prompt({ sessionId: agent.sessionId, prompt: promptBlocks });

    // ── 6. 结束流积累，获取累积内容 ──
    const acc = ctx.stateManager?.finishStream(params.contextKey);

    // ── 7. 构建用户/Agent 消息并持久化 ──
    const timeStr = new Date().toLocaleTimeString();
    const userMsg: ChatMsg = {
      id: params.msgIdPrefix + Date.now().toString(36),
      role: 'user', content: params.userText, thinking: '',
      time: timeStr, status: 'sent', moduleName: params.contextKey,
      sessionId: agent.sessionId as string | undefined,
    };
    const agentMsg: ChatMsg = {
      id: params.msgIdPrefix + (Date.now() + 1).toString(36),
      role: 'agent', content: acc?.reply || '', thinking: acc?.thinking || '',
      timeline: acc?.timeline || [], time: timeStr, status: 'completed', moduleName: params.contextKey,
    };

    const existingMsgs = await ctx.stateManager?.loadContext(params.contextKey) ?? [];
    existingMsgs.push(userMsg, agentMsg);
    await ctx.stateManager?.saveContext(params.contextKey, existingMsgs);

    // ── 8. 后处理（总结 + 工作区 diff — 仅 agent:send） ──
    if (params.postProcess) params.postProcess(existingMsgs, agent);

    // ── 9. 恢复 idle 状态 → IPC 通知 ──
    ctx.agentStatus.set(params.domainName, 'idle');
    ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: params.domainName, status: 'idle' });

    return { result: { reply: acc?.reply || '', thinking: acc?.thinking || '', tools: acc?.tools || '', timeline: acc?.timeline || [], stopReason: (result as { stopReason?: string }).stopReason } };
  } catch (err) {
    // ── 错误处理：停止流 + 标记错误 ──
    ctx.logger.error(`send failed [${params.domainName}]: ${(err as Error).message}`);
    ctx.stateManager?.stopStream(params.contextKey);
    ctx.agentStatus.set(params.domainName, 'error');
    ctx.mainWindow?.webContents.send(IpcChannel.Push.AgentStatus, { name: params.domainName, status: 'error' });
    return { error: (err as Error).message };
  } finally {
    // ── 释放锁 ──
    resolveLock();
    params.lockMap.delete(params.domainName);
  }
}
