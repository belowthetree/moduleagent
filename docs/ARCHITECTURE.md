# ModuleAgent 架构

> 最后更新: 2026-07-21（重写：旧文档描述的 ACP 子进程架构已删除，本文档与当前源码一致）

## 1. 系统概述

ModuleAgent 是一个**模块化 Agent 编排框架**：以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块运行一个**进程内 Agent**。没有 ACP 协议、没有外部 Agent 子进程——所有 Agent 都是运行在主进程（或 CLI 进程）内的 LLM 推理循环，基于 ai-sdk `generateText` 构建，内置文件/搜索/命令/跨模块等工具。

### 核心能力

- **模块化扫描**：递归扫描 `module.md` 构建模块依赖树（`ModuleScanner` / `ModuleGraph` / `ModuleParser`）
- **进程内 Agent 编排**：每个模块对应一个 `Agent` 实例（生命周期 + 忙队列）
- **跨模块协作**：Agent 之间通过 `module_call` / `module_query` 工具互相调用，由 `CrossModuleRouter` 进程内路由并治理
- **角色 Agent**：跨模块的职责化 Agent（文档、架构审查等）
- **工作流与工作空间隔离**：工作流步骤在 `.module-agent/workspace/` 的隔离源码副本中执行

## 2. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│ 表现层（双路径，二选一）                                      │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │ Electron 路径（主路径）    │  │ CLI/TUI 路径（次路径）    │ │
│  │ Vue 3 渲染进程            │  │ src/cli（commander 命令） │ │
│  │  ↑ IPC (contextBridge)   │  │ src/tui（@opentui/solid） │ │
│  │ src/main/index.ts        │  │                          │ │
│  │  → bridge.ts (Electron-  │  │                          │ │
│  │    Bridge, IPC handlers) │  │                          │ │
│  └───────────┬──────────────┘  └────────────┬─────────────┘ │
├──────────────┴───────────────────────────────┴──────────────┤
│ 共享编排核心：src/core/ModuleAgentCore                       │
│  ├─ ModuleAgentSubsystem   模块 Agent 生命周期/消息/上下文    │
│  ├─ RoleAgentSubsystem     角色 Agent（可选）                │
│  ├─ WorkflowSubsystem      工作流（可选）                    │
│  └─ CrossModuleRouter      跨模块路由（src/agents/mcp/）     │
├─────────────────────────────────────────────────────────────┤
│ 进程内 Agent 内核：src/agents/                               │
│  Agent（状态机+忙队列）→ KernelFactory → AgentKernel →       │
│  AgentLoop（ai-sdk generateText 循环 + 内置工具）            │
└─────────────────────────────────────────────────────────────┘
```

## 3. 进程内 Agent 内核

分层调用链（全部同进程，无 IPC、无子进程）：

- **`Agent`**（`src/agents/Agent.ts`）：Agent 生命周期状态机 + 忙队列。消息经 `Agent.send()` 排队串行执行；跨队列的调用链上下文通过 `AsyncLocalStorage.snapshot()` 传播。
- **`KernelFactory`**（`src/agents/KernelFactory.ts`）：创建 `AgentKernel` 实例。负责 Windows 路径规范化（`cwd.replace(/\\/g, '/')`）。
- **`AgentKernel`**（`src/agents/kernel/AgentKernel.ts`）：组装 `AgentLoop`、工具注册表（`ToolRegistry`）、沙箱（`Sandbox`）、系统提示词。
- **`AgentLoop`**（`src/agents/kernel/AgentLoop.ts`）：核心推理循环。基于 ai-sdk `generateText` + `stopWhen` 自动处理多轮工具调用；消息历史全程保持 ai-sdk `ModelMessage[]`（`response.messages` 只含本次新生成的消息，必须追加而非替换）。

内置工具（`src/agents/kernel/tools/`）：`file_read` / `file_write` / `file_edit` / `search` / `list_files` / `execute_command` / `git_operations` / `module_call` / `module_query` / `module_list` / `module_context_read_*`。

优化模块（集成在 AgentLoop 内）：

| 模块 | 作用 |
|------|------|
| `TokenEstimator` | token 用量校准估算 |
| `ToolResultSnipper` | 零 LLM 的工具结果裁剪（snip） |
| `HistoryTruncator` | 滑动窗口截断（tail token 预算） |
| `ContextCompactor` | 在线压缩（fastModel 摘要折叠） |
| `ModelRouter` | 快/慢模型路由 |
| `StormBreaker` | 工具调用死循环检测 |
| `ArchiveWriter` | 被丢弃内容归档到 `.module-agent/archives/` |

## 4. 上下文压缩管道

`AgentLoop.send()` 中按阈值顺序执行三级管道（占比均相对 `contextWindow`）：

1. **snip（60%）**：`ToolResultSnipper` 零 LLM 裁剪老旧工具结果；
2. **compact（70%）**：`ContextCompactor` 用 fastModel 摘要折叠可折叠段落（需配置 `fastModel` 且 `compaction.enabled`）；
3. **truncate（80%）**：`HistoryTruncator` 按 tail token 预算截断历史。

各级丢弃的内容统一由 `ArchiveWriter` 归档到 `.module-agent/archives/<module>/*.jsonl`。上下文用量越过 50% 时通过 `onContextUsage` 事件通知 UI（滞回：降至 40% 以下后重置）。

其他关键约定：

- **系统提示词**作为独立 `system` 角色消息经 `Agent.start({ systemPrompt })` 注入（前缀缓存固定），不并入首条用户消息；首条用户消息只携带模块上下文（`progressiveDisclosure` 开启时为 Tier-1 摘要）。
- **重试安全**：`generateText` 的外层重试以 `stepsCompleted === 0` 为前提——已完成步骤后重试会重复执行副作用工具（`file_write` 等）。

## 5. 跨模块路由治理

`module_call` / `module_query` 工具调用经 `CrossModuleRouter.routeCall`（`src/agents/mcp/McpBackend.ts`）路由，**必须走 `Agent.send` 队列**（直接调 `kernel.send` 会重入 `AgentLoop.messages` 破坏历史）。

治理机制：

- **调用链传播**：`src/agents/mcp/CallChain.ts` 基于 `AsyncLocalStorage` 传播调用链，跨 `Agent` 忙队列经 `AsyncLocalStorage.snapshot()` 保持。
- **跳数限制**：`crossModule.maxHops`（默认 3）+ 环路检测。
- **死锁检测**：等待图（`pendingWaits`，requester → targets）做 wait-for 死锁检测。
- **超时**：`crossModule.timeoutMs`（默认 120s）。
- **上下文落盘**：跨模块请求/响应由 router 局部累积后经 `appendCrossContext` 写入目标模块上下文。

## 6. 双路径共享核心

- **Electron 路径（主路径）**：`src/main/index.ts` 创建窗口并实例化 `ElectronBridge`（`src/main/bridge.ts` + `src/main/handlers/`），所有 IPC、Agent 生命周期、MCP 后端、角色 Agent 生命周期都经 bridge 汇聚到 `ModuleAgentCore`。渲染进程为 Vue 3 + Pinia + Element Plus，经 `src/preload/index.ts` 的 `contextBridge`（`window.moduleAgent`）与主进程通信。
- **CLI/TUI 路径（次路径）**：`src/cli/`（`module-agent serve` / `tui` 等命令）+ `src/tui/`（@opentui/solid 终端 UI），同样驱动 `ModuleAgentCore`。
- 两条路径共享 `src/core/ModuleAgentCore` 与整个 `src/agents/` 内核，差异仅在表现层与回调接线的实现。

## 7. 运行时目录（用户项目根下）

| 目录 | 用途 |
|------|------|
| `.module-agent/module/` | 模块 `.md` 文档的最终存放位置 |
| `.module-agent/workspace/` | 工作流步骤执行的隔离源码副本 |
| `.module-agent/context/` | Agent 会话上下文存储（每模块上限 200 条 / 5MB） |
| `.module-agent/archives/` | snip/compact/truncate 丢弃内容的归档 |
| `.module-agent.json` | 项目配置文件（schema 见 `src/config/schema.ts`） |

## 8. 构建产物

- **Renderer**：electron-vite（Vite + Vue 插件）→ `out/renderer/`
- **Main**：electron-vite → CJS `out/main/`，externals：`electron`、`fs-extra`、`gray-matter`、`marked`、`zod`、`path`、`url`、`esbuild`
- **Preload**：electron-vite → CJS `out/preload/`，external：`electron`
- **CLI**：esbuild → CJS 单文件 `dist/cli.cjs`（externals：`@opentui/*`）
- 内核工具全部进程内运行，没有独立的 MCP server 产物。

## 9. 关键源码索引

| 位置 | 说明 |
|------|------|
| `src/main/index.ts` / `src/main/bridge.ts` | Electron 入口 / IPC 桥（ElectronBridge） |
| `src/core/ModuleAgentCore.ts` | 统一编排核心（组合三大子系统 + 路由器） |
| `src/agents/Agent.ts` | Agent 生命周期 + 忙队列 |
| `src/agents/kernel/AgentLoop.ts` | 推理循环 + 上下文压缩管道 |
| `src/agents/mcp/McpBackend.ts` | CrossModuleRouter 跨模块路由 |
| `src/agents/mcp/CallChain.ts` | 调用链 AsyncLocalStorage 传播 |
| `src/config/` | ConfigLoader / Zod schema / 默认值 |

更详细的约定（Windows 路径规范化、Map 序列化、配置管道链等）见根目录 `AGENTS.md`。
