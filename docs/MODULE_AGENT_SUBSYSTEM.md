# ModuleAgentSubsystem — 模块 Agent 子系统

> 文件：`src/core/ModuleAgentSubsystem.ts` | 类：`ModuleAgentSubsystem`

## 概述

`ModuleAgentSubsystem` 是模块 Agent 生命周期的完整管理者。它由 `ModuleAgentCore` 创建，负责从配置加载到 Agent 启动、消息发送、跨模块通信的整个流程。Agent 为**进程内 LLM 内核**（`Agent` → `KernelFactory` → `AgentKernel` → `AgentLoop`），无子进程、无 ACP 连接。

## 核心职责

1. **初始化**：加载项目配置 → 扫描 `.module-agent/module/` → 构建模块图 → 加载系统提示 → 初始化 SessionStore
2. **Agent 启动**：解析模块 Agent 配置 → 计算 cwd 与 Sandbox 可见性 → 创建进程内内核 → 以独立 system 角色注入系统提示
3. **消息发送**：路由消息 → 去重检查 → 构建 Prompt → `agent.send()` → 流累积 + 上下文持久化
4. **生命周期管理**：启动/取消/清上下文 Agent，管理 `agents` Map

## 关键类型

```typescript
export interface AgentEntry {
  agent: Agent;             // 进程内 Agent（内核模式）
  modulePath: string;       // Agent 工作目录（cwd）
  sourcePath?: string;      // 模块源码目录（用于 workspace diff 对比）
}
```

## 生命周期

### init(projectRoot)

```
1. ConfigLoader.load(projectRoot)
   → 加载 .module-agent.json，获取 ConfigEntry + exclude 规则
   （ignoreConfigProjectPath 时以 init 的 projectRoot 覆盖 projectPath，TUI 使用）

2. ModuleScanner.scan({ projectRoot: .module-agent/module/ })
   → 递归扫描 module.md 文件

3. new ModuleGraph().build(descriptors, projectRoot)
   → 构建模块依赖树

4. loadSystemPrompts(configDir)
   → 加载 config/knowledge/mainagentprompt.md 和 subagentprompt.md

5. new SessionStore(.module-agent/context/, { maxMessages: contextHistoryLimit })
   → 流累积 + 上下文持久化（每模块默认上限 200 条）
```

返回 `InitResult { moduleNames, rootAgent }`。

### startAgent(moduleName)

```
1. agents Map 命中 → 直接返回
2. pendingStarts Map 命中 → 复用进行中的 Promise（去重）
3. withRetry(最多 2 次) → _startAgentInternal(moduleName)
   a. resolveAgentConfig(moduleName)
      → agents.modules 覆盖 > agents.default
      （provider/apiKey/baseUrl/model/maxTokens/fastModel/contextWindow/defaultMode）
   b. _getSourcePath(moduleName)
      → projectPath + relativePath，经 normalizeCodeSourcePath 归一化
      （防非 Windows 平台把盘符路径当相对路径解析）
   c. 计算 cwd：根模块 = .module-agent/module/，子模块 = 源码目录
   d. new AgentSandbox({ allowed, excluded })
      → 根模块仅允许 .module-agent/module/；子模块允许自身源码目录、排除直接子模块源码目录
   e. Agent.start({ config, cwd, sandbox, isRoot, crossModuleRouter,
                    systemPrompt: isRoot ? mainPrompt : subPrompt,
                    truncation, compaction, archiveDir, onNotification, ... })
      → KernelFactory 创建进程内内核；系统提示以独立 system 角色注入（前缀缓存锚定）
   f. sessionPrompted.delete(moduleName) → 重置首次消息标记
   g. 存入 agents Map
```

### sendMessage(text, moduleName?)

```
1. _routeMessage(text)
   → 按 @name 关键词或文件路径匹配路由到目标模块

2. dedupMessage(lastSent, moduleName, text)
   → 3 秒内相同消息去重

3. sendGuard.acquire(moduleName)
   → 按模块串行化发送（promise 链互斥）

4. startAgent(moduleName) → 自动启动（若未运行）

5. buildPromptBlocks({ moduleName, userText, graph, prompts, sessionPrompted,
                       cwd, progressiveDisclosure })
   → 首次消息：cwd 提示 + 模块上下文（Tier-1 摘要或全量）+ patterns + experience
   → 后续消息：仅用户消息
   → 系统提示不在此处（已由 Agent.start 以独立 system 角色注入）

6. agent.send(blocks)
   → 进程内内核执行（非 Idle 状态入队串行化，Error 状态同样入队并主动触发消费）

7. SessionStore.finishStream → 构建 user/agent 消息 → saveContext 持久化
   → onPostSend 钩子（总结 + 工作区 diff）

8. 流式响应通过 onNotification → CoreCallbacks.onStreamChunk / onToolCall
```

### cancel / clearContext / dispose

- `cancel()`：遍历所有 streaming 状态的 Agent 调用 `agent.cancel()`——abort 在途调用并以 `Canceled` 错误 reject 全部排队项。**只取消不删除**，Agent 保持可复用（与 Electron 路径语义一致）。
- `clearContext(moduleName?)`：`agent.clearContext()` 创建新会话 + 删除持久化上下文文件 + 清 `sessionPrompted`/`lastSent`；失败时回退为停止内核（下次使用时自动重启）。
- `dispose()`：停止所有 Agent（`agent.stop()`），清空 agents/pendingStarts/sendGuard/sessionPrompted/_agentStatus。

## mode / model 切换（如实描述）

内核模式没有 Agent 上报的 mode/模型列表，也不支持运行时切换：

- `getAgentModes()` / `getAgentModels()` → 返回 `[]`
- `setAgentMode()` / `setAgentModel()` → `Promise<boolean>`，内核模式恒为 `false` 并记录 warn 日志（未生效）；`Agent.setConfigOption` 同类告警只发一次
- `setDefaultMode()` 仅更新内存中的 `agents.default.defaultMode`（新启动的 Agent 会用到）

## 关键设计

### 发送互斥（SendGuard）

`SendGuard`（`src/core/AgentSubsystemUtils.ts`）为真 promise 链互斥：同一模块的获取严格串行，每个等待者挂在前序持有者的链尾，≥3 个并发等待者也不会同时"持锁"；仅当无后续等待者时清理 Map 项。

### 首次消息注入

通过 `sessionPrompted` Set 跟踪每个模块是否已注入首条消息上下文。`startAgent` 时清除标记，确保新会话的首次消息包含完整模块上下文。系统提示（mainagent/subagent prompt）**不**随首条用户消息注入，而是在 `Agent.start({ systemPrompt })` 时以独立 system 角色消息注入（前缀缓存锚定）。

### 消息路由

`_routeMessage(text)` 识别三种路由模式：
- **关键词路由**：`@moduleName`、`模块: name`、`交给 name` → 路由到目标模块。精确匹配（大小写不敏感）优先；仅模糊（includes）命中时给用户可见的系统提示（"已按模糊匹配路由到…"）；目标未启动时由 `sendMessage` 自动 `startAgent`，不再静默降级到当前模块。
- **路径路由**：根据消息中的文件路径所属模块路由（根模块除外）。
- **默认**：停留在 `currentModule`（用户当前选中的模块）。

### tool_call 日志脱敏

`tool_call` 通知写入日志前经 `formatNotificationForLog()` 处理：`maskSensitiveForLog()` 递归将 `apiKey`/`token`/`secret`/`password` 等敏感键的值替换为 `***`（限深 3 层），整体序列化截断至 500 字符——工具输入可能含文件内容或密钥，不完整落盘。

### 跨模块上下文落盘

跨模块调用的请求/响应不经目标模块的活跃流累积器，由 `appendCrossContext()` 委托 `SessionStore.appendCrossContext()` 独立落盘（仅请求 + 回复两条）。

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，创建并持有 `ModuleAgentSubsystem` 实例 |
| `KernelFactory` / `Agent` | 创建进程内 Agent 内核并管理其生命周期 |
| `ModuleScanner` / `ModuleGraph` | 初始化时调用，构建模块图 |
| `ConfigLoader` | 加载 `.module-agent.json` 配置 |
| `PromptBuilder` | 加载系统提示、构建发送给 Agent 的 Prompt |
| `SessionStore` | 流累积 + 上下文持久化（`.module-agent/context/`） |
| `CrossModuleRouter` | 跨模块调用路由（`crossModuleRouter` 字段，由 Core 装配） |
| `AgentSandbox` | 文件访问沙箱（allowed/excluded，realpath 校验） |
| `SendGuard` | 按模块的发送互斥锁 |
