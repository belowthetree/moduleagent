# CrossModuleRouter & CallChain — 跨模块通信路由

> 文件：`src/agents/mcp/McpBackend.ts`（类 `CrossModuleRouter`）, `src/agents/mcp/CallChain.ts`, `src/agents/kernel/tools/mcp-bridge.ts`

> 历史说明：ACP 时代的 `McpBackendServer`（127.0.0.1 HTTP 代理）与 `src/protocol/mcp/CommunicationBus.ts` 已随 ACP 子进程层一并移除。当前跨模块调用完全在**进程内**完成：内核工具 `module_call` / `module_query` 直接调用 `CrossModuleRouter.routeCall` → 目标模块的 `Agent.send` 队列。

---

## CrossModuleRouter — 跨模块通信路由器

**类**：`CrossModuleRouter`（`McpBackendCallbacks` 为 `CrossModuleRouterCallbacks` 的别名）

### 概述

`CrossModuleRouter` 在主进程内路由模块间的 `module_call` 和 `module_query` 请求。它负责调用链治理（环检测、跳数限制、wait-for 死锁检测）、目标 Agent 的自动启动、跨模块上下文的通知与落盘，以及调用超时控制。

### 创建

```typescript
const router = new CrossModuleRouter(callbacks, {
  maxHops: 3,          // 跨模块调用最大跳数（默认 3）
  timeoutMs: 120_000,  // 单次调用超时（默认 120s）
});
```

### CrossModuleRouterCallbacks

```typescript
interface CrossModuleRouterCallbacks {
  getAgentEntry(moduleName: string): Agent | undefined;
  startAgent(moduleName: string): Promise<boolean>;   // 自动启动未运行的 Agent
  buildPromptBlocks(moduleName: string, userText: string): PromptBlock[];
  sendCrossContext?(source, target, direction: 'sent' | 'received',
                    phase: 'request' | 'response', content: string): void;  // UI 通知
  setAgentStatus?(moduleName: string, status: 'idle' | 'streaming' | 'error'): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
  // 跨模块上下文直接落盘（不经过目标模块的活跃流累积器）：
  // routeCall 完成后调用，requestText/responseText 由 router 局部累积
  appendCrossContext?(moduleName: string, requestText: string,
                      responseText: string): Promise<void> | void;
  getModuleList?(requestingModule: string): { name: string; description: string; path: string }[];
}
```

注：ACP 时代的 `startStream` / `finishStream` / `saveCrossContext` 回调已删除，由 `appendCrossContext` 取代。

### routeCall(params)

```
routeCall({ targetModule, requestingModule, task?, query? })
  │
  ├─ 调用链治理（CallChain，AsyncLocalStorage 传播）
  │   ├─ 环检测：targetModule 已在当前链中 → 拒绝并提示
  │   └─ 深度限制：链长 > maxHops（默认 3）→ 拒绝并提示
  │
  ├─ wait-for 死锁检测
  │   ├─ 等待图 pendingWaits: Map<string, Set<string>>
  │   │   （requester → 多个并行 target，多边）
  │   └─ 从 target 沿 wait-for 图 BFS，能回到 requester 即成环 → 拒绝
  │
  ├─ getAgentEntry(targetModule) → 不存在则 startAgent(targetModule) 自动启动
  │
  ├─ sendCrossContext 通知（请求双方各一条：sent/received × request）
  │
  ├─ _addWaitEdge(requester, target)，创建 AbortController
  │
  ├─ 执行调用：
  │   ├─ 不再触碰目标模块的共享流累积器（startStream/finishStream），
  │   │   避免与用户正在进行的流式对话竞争
  │   ├─ runWithChain([...chain, target], () =>
  │   │     entry.send(promptBlocks, { signal: abort.signal }))
  │   │   → 走 Agent.send 队列（busy 时排队），调用链上下文随 ALS 传播
  │   └─ _withTimeout：超时先 abort.abort() 再 reject
  │       → 排队中的 send 被跳过，在途的 send 被真正中止
  │
  ├─ appendCrossContext(targetModule, requestText, responseText)
  │   → 跨模块上下文独立落盘（见下文）
  │
  ├─ sendCrossContext 通知（响应双方各一条：sent/received × response，截断 200 字符）
  │
  └─ finally: _removeWaitEdge(requester, target)（仅删这一条边，保留并行边）
```

返回值：`{ success, result? }`（module_call）或 `{ success, answer? }`（module_query）；各类拒绝/失败返回 `{ success: false, error }`，错误信息带有可供模型改派任务的提示。

### 跨模块上下文落盘（appendCrossContext）

由 Core 装配为 `SessionStore.appendCrossContext(module, request, response)`：

- 把「请求 + 回复」**两条消息**直接追加进目标模块的上下文文件
- 不含 tool_call 时间线（跨模块调用的内部推理过程对目标模块的用户视图不可见）
- 不经过目标模块的活跃流累积器，因此不会与用户对话竞争

### 跨模块通信数据流

```
Agent A（模块 A 的内核）
  │ 内核工具: module_call({ targetModule: "B", goal, background, ... })
  ▼
mcp-bridge 工具（createMcpBridgeTools，随内核工具注册表注入）
  │ router.routeCall({ targetModule, requestingModule: "A", task })
  ▼
CrossModuleRouter（主进程内）
  │ → 链治理 + 死锁检测 → 自动启动 Agent B
  │ → Agent B 的 send 队列（busy 时排队，可被超时 abort）
  │ → appendCrossContext 落盘 + sendCrossContext UI 通知
  ▼
结果作为工具返回值回到 Agent A 的推理循环
```

### mcp-bridge 工具

`createMcpBridgeTools(router, requestingModule)` 仅在内核注入了 `crossModuleRouter` 时注册（模块 Agent 有，角色/工作流 Agent 无）：

| 工具 | 参数 | 说明 |
|------|------|------|
| `module_call` | `targetModule`, `goal`, `background`, `expectedOutput?`, `constraints?` | 委托子任务，等待完整执行结果 |
| `module_query` | `targetModule`, `query`, `background?` | 查询目标模块信息 |
| `module_list` | （无） | 列出可访问模块（经 `getModuleList` 回调，标注文档路径与父模块） |

---

## CallChain — 跨模块调用链追踪

`src/agents/mcp/CallChain.ts`

基于 `AsyncLocalStorage` 在因果嵌套的 await 链上自动传播调用链，模型侧零感知：

```typescript
currentChain(): string[]              // 当前异步上下文的调用链（无上下文时为空链）
runWithChain(chain, fn)               // 在指定调用链上下文中执行
```

调用链同时能穿越 `Agent` 的忙时队列传播（`AsyncLocalStorage.snapshot()`），供 `routeCall` 做环检测与深度限制。

---

## Core 装配（ModuleAgentCore.startMcpBackend）

`ModuleAgentCore.initAll(projectRoot, configDir?, { onCrossModuleContext? })` 内部调用 `startMcpBackend()` 完成装配：

- `getAgentEntry` / `startAgent` / `buildPromptBlocks` / `setAgentStatus` → 委托 `ModuleAgentSubsystem`
- `appendCrossContext` → `SessionStore.appendCrossContext`（跨模块上下文落盘）
- `sendCrossContext` → 先走 `onCrossModuleContext` 装饰钩子，再走普通回调 `onCrossModuleMessage`
- `limits` 来自主配置 `crossModule.maxHops` / `crossModule.timeoutMs`

### onCrossModuleContext 钩子（Electron timeline 装饰）

```typescript
type CrossModuleContextHook = (info: {
  fromModule: string;
  toModule: string;
  direction: 'sent' | 'received';
  phase: 'request' | 'response';
  content: string;
}) => void;
```

Electron 侧在 `project:scan`（`projectHandlers.ts`）调用 `core.initAll(...)` 时注入该钩子：为最近一条 `module_call` / `module_query` 工具调用的 timeline 事件补上跨模块方向/目标/阶段标记（`crossDirection` / `crossModule` / `crossPhase`），或在流状态中追加一条独立的跨模块事件。TUI 无此逻辑。
