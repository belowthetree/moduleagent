# ElectronBridge — Electron 桥接层

> 文件：`src/main/bridge.ts`, `src/preload/index.ts` | 类：`ElectronBridge`

## 概述

`ElectronBridge` 是 Electron 主进程中连接 Core 层和 UI 层的桥接适配器。它将 `CoreCallbacks` 翻译为 Electron IPC 事件，并通过 8 个领域 handler 模块（`src/main/handlers/`）注册全部 37 个 `ipcMain.handle()` 通道。Agent 状态、流式累积、上下文持久化与 MCP 后端装配均已移入 Core 层；bridge 自身只做 IPC 编解码，并持有 `ExperienceSummarizer`（经 `PostSendHooks` 注入 Core）。

## 架构位置

```
┌─────────────────────────────────┐
│  Renderer Process (Vue 3)       │
│  ┌───────────────────────────┐  │
│  │ window.moduleAgent.*      │  │  ← contextBridge API
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  Preload (contextBridge)        │
│  ┌───────────────────────────┐  │
│  │ ipcRenderer.invoke / .on  │  │
│  └───────────────────────────┘  │
├─────────────────────────────────┤
│  Main Process                   │
│  ┌───────────────────────────┐  │
│  │ ElectronBridge（编排层）    │  │
│  │  ├─ ModuleAgentCore       │  │
│  │  │  （Agent 状态/流累积/   │  │
│  │  │   上下文/MCP 后端）     │  │
│  │  ├─ handlers/ 8 个领域    │  │
│  │  │  handler（37 通道）     │  │
│  │  └─ ExperienceSummarizer  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## 核心职责

### 1. IPC 处理器注册

`ElectronBridge.registerAllHandlers()` 委托 8 个领域 handler 注册全部通道（通道名常量集中在 `src/protocol/IpcChannels.ts`，共 32 个 invoke 通道 + 5 个 push 通道）：

**模块 Agent 通道**：

| 通道 | 处理逻辑 |
|------|---------|
| `project:scan` | ConfigLoader.loadOrCreate + `core.initAll(projectRoot, undefined, { onCrossModuleContext })`（模块扫描 + 角色/工作流初始化 + MCP 后端装配一次性完成），随后 `core.getGraph()` 直接取图返回，无重复扫描与手工路由装配 |
| `project:getTree` | 从 `core.getGraph()` 构建 TreeNode |
| `project:generateModules` | 启动临时内核 Agent 分析源码目录，生成 module.md（写入 `.module-agent/module/`，不覆盖已有文件） |
| `agent:start` | core.modules.startAgent(moduleName)（已在运行则直接返回现有 sessionId） |
| `agent:send` | core.modules.sendMessage(text, moduleName)（锁、流累积、上下文保存、PostSendHook 均在 Core 内完成） |
| `agent:cancel` | agent.cancel()（abort 在途调用，agent 保持可复用）+ core.modules.cancelStream()，返回已累积内容 |
| `config:save` | 合并更新后先经 `WorkspaceConfigSchema`（zod）校验：失败返回 `{success:false,error}`，不写盘也不更新运行时状态；通过才写入 `.module-agent.json` |
| `config:get` | ConfigLoader.load(projectRoot)（失败回落 DEFAULT_CONFIG） |
| `context:get` / `context:clear` / `context:clearAll` | 委托 core.modules（SessionStore 持久化） |
| `dialog:selectDir` | dialog.showOpenDialog() |

**已删除的通道**：`agent:stop`、`agent:isRunning`、`agent:getRunning`（内核模式无子进程，无意义）；`migrate:check`、`migrate:data`（`migrationHandlers.ts` 整文件已删）。workspace diff 功能在主进程从未实现过 handler，不存在任何 `workspaceDiff:*` 通道。

**角色 Agent 通道**（10 个，委托 core.roles）：

| 通道 | 处理逻辑 |
|------|---------|
| `role:list` | 返回 config.roles |
| `role:save` | 更新 .module-agent.json 的 roles 数组 |
| `role:delete` | 删除 + cleanupRoleWorkspace() |
| `role:start` | core.roles.startRole(roleName) |
| `role:send` | core.roles.sendMessage(roleName, text) |
| `role:cancel` | 取消角色 Agent 在途请求 |
| `role:stop` | core.roles.stopRole(roleName) |
| `role:isRunning` | 查询运行状态 |
| `role:getContext` / `role:clearContext` | 角色上下文读写（clearContext 同时清运行中 agent 的内存历史与 sessionPrompted） |

**工作流通道**（10 个，委托 core.workflows）：`workflow:list` / `load` / `create` / `delete` / `stepSave` / `stepDelete` / `stepAdd` / `execute` / `cancel` / `status`。

**知识通道**（5 个）：`knowledge:list` / `read` / `save` / `create` / `delete`。

knowledge / workflow 两类 handler 的文件名输入统一经 `handlers/fileNameSanitize.ts` 消毒：路径分隔符与 Windows 非法字符（`<>:"/\|?*`）替换为 `_`，清洗后为 `''` / `'.'` / `'..'` 直接抛错拒绝，防止 `../` 路径穿越。

**Push 通道**（Main → Renderer）：`agent:stream`、`agent:status`、`role:stream`、`role:status`、`agent:cross-context`。

### 2. CoreCallbacks → IPC 翻译

```typescript
const callbacks: CoreCallbacks = {
  onStreamChunk: (moduleName, text) => {
    mainWindow.webContents.send('agent:stream', { moduleName, update: text, data: {}, reply: text });
  },
  onStreamComplete: (moduleName) => {
    // 状态由 Core 按模块管理，bridge 不再处理
  },
  onStreamError: (moduleName, error) => {
    logger.error(`[${moduleName}] stream error: ${error}`);
  },
  onStatusChange: (status) => {
    // 状态由 Core 按模块追踪（onModuleStatusChange）
  },
  onMessage: (message) => {
    // 系统消息（permission 拒绝、队列通知）→ agent:stream (system_message)
  },
  onModuleStatusChange: (moduleName, status) => {
    mainWindow.webContents.send('agent:status', { name: moduleName, status });
  },
};
```

### 3. 流式更新转发

流式推送由内核通知驱动，累加器在 Core 层（StreamAccumulator），bridge 只取快照转发：

```
AgentKernel 流式通知
  → ModuleAgentCoreOptions.onSessionUpdate（由 ElectronBridge 注入）
  → core.modules.getStreamState(moduleName)  // Core 内累加器快照
  → mainWindow.webContents.send('agent:stream', {
      moduleName, update, data,
      reply, thinking, tools, timeline, sections  // 累加器快照
    })
  → Renderer: agentStore (Pinia) 响应式更新 → 组件渲染
```

角色 Agent 走独立的 `onRoleSessionUpdate` → `role:stream` 通道（流累积键为 `workrole:<name>`）。

### 4. MCP 后端与跨模块上下文

MCP 后端不再由 bridge 自建：`project:scan` 调用的 `core.initAll()` 一次性完成模块扫描、角色/工作流子系统初始化与 MCP 后端（跨模块路由器）装配。Electron 特有的跨模块 timeline 装饰与推送通过 `onCrossModuleContext` 钩子注入：

```typescript
await core.initAll(projectRoot, undefined, {
  onCrossModuleContext: ({ fromModule, toModule, direction, phase, content }) => {
    // 1. 装饰最近一条 module_call/module_query 工具调用的 timeline 事件
    // 2. webContents.send('agent:cross-context', { moduleName, crossModule, direction, phase, content, time })
  },
});
const graph = core.getGraph();  // initAll 已完成扫描，直接取图，避免重复扫描
```

跨模块上下文的落盘（`SessionStore.appendCrossContext`）由 Core 内部接线，不经 bridge。

### 5. ExperienceSummarizer 触发

summarizer 由 bridge 持有，经 `PostSendHooks` 注入 Core，每次对话完成后由 Core 触发：

```typescript
const onPostSend = createPostSendHook({
  logger, summarizer,
  getSummarizationEnabled: () => this.summarizationEnabled,
  configDir,
  getProjectRoot: () => this.core.getProjectRoot(),
});
// 作为 ModuleAgentCoreOptions.onPostSend 传入
```

### 6. 日志与退出流程

- 日志目录固定在 `app.getPath('userData')/logs`（打包后不依赖 cwd）；主进程不再使用 `console.*`，统一走 `defaultLogger`。
- `window-all-closed` 退出顺序：`await bridge.cleanup()`（内部 `await core.dispose()`，等待进行中的 context 保存完成）→ `await defaultLogger.close()` → `app.quit()`。

---

## Preload API

`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('moduleAgent', api)` 暴露 API：

```typescript
interface ModuleAgentApi {
  selectDir(title): Promise<string | null>
  scanProject(projectRoot): Promise<ScanResult>
  generateModules(projectRoot): Promise<{ success: boolean; count: number; error?: string }>
  getTree(): Promise<TreeNode | null>
  // cmd/args/cwd 为 ACP 时代兼容保留，内核模式忽略
  startAgent(moduleName, cmd, args, cwd): Promise<{ sessionId?, error? }>
  sendMessage(moduleName, text, cwd?): Promise<{ result?: { reply, thinking, tools, stopReason }, error? }>
  cancelAgent(moduleName): Promise<{ accumulated? }>
  onAgentStream(callback): () => void           // 返回取消订阅函数
  onAgentStatus(callback): () => void
  onCrossContext(callback): () => void
  saveAgentConfig(...): Promise<{ success: boolean; error?: string }>
  getAgentConfig(projectRoot): Promise<{ provider?, apiKey?, baseUrl?, model?, projectPath?, summarizationEnabled? }>
  getContext(moduleName) / clearContext(moduleName) / clearAllContexts()
  // 角色：getRoles / saveRole / deleteRole / startRoleAgent / sendRoleMessage /
  //       cancelRoleAgent / stopRoleAgent / isRoleAgentRunning /
  //       getRoleContext / clearRoleContext / onRoleAgentStream / onRoleAgentStatus
  // 知识：knowledgeList / knowledgeRead / knowledgeSave / knowledgeCreate / knowledgeDelete
  // 工作流：workflowList / workflowLoad / workflowCreate / workflowDelete /
  //         workflowStepSave / workflowStepDelete / workflowStepAdd /
  //         workflowExecute / workflowCancel / workflowStatus
}
```

已移除：`stopAgent`、`isAgentRunning`（对应 IPC 通道已删）。

**安全模型**：`contextIsolation: true` + `nodeIntegration: false`，渲染进程无法直接访问 Node.js API。
