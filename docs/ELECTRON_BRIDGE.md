# ElectronBridge — Electron 桥接层

> 文件：`src/main/bridge.ts`, `src/preload/index.ts` | 类：`ElectronBridge`

## 概述

`ElectronBridge` 是 Electron 主进程中连接 Core 层和 UI 层的桥接适配器。它将 `CoreCallbacks` 翻译为 Electron IPC 事件，注册所有 `ipcMain.handle()` 处理器，管理 Agent 状态、MCP 后端和对话总结。

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
│  │ ElectronBridge            │  │
│  │  ├─ ModuleAgentCore       │  │
│  │  ├─ AgentStateManager     │  │
│  │  ├─ McpBackendServer      │  │
│  │  └─ ExperienceSummarizer  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## 核心职责

### 1. IPC 处理器注册

`ElectronBridge` 在构造函数中注册所有 `ipcMain.handle()` 处理器：

**模块 Agent 通道**：

| 通道 | 处理逻辑 |
|------|---------|
| `project:scan` | ModuleScanner.scan() + ModuleGraph.build() + ModuleAgentSubsystem.init() |
| `agent:start` | core.modules.startAgent(moduleName) |
| `agent:send` | core.modules.sendMessage(moduleName, text) → connection.prompt() |
| `agent:cancel` | core.modules.cancelAgent(moduleName) |
| `agent:stop` | core.modules.stopAgent(moduleName) |
| `config:save` | fs.writeJson('.module-agent.json', config) |
| `config:get` | ConfigLoader.load(projectRoot) |
| `context:get` | stateManager.loadContext(moduleName) |
| `context:clear` | stateManager.clearContext(moduleName) |
| `dialog:selectDir` | dialog.showOpenDialog() |

**角色 Agent 通道**：

| 通道 | 处理逻辑 |
|------|---------|
| `role:list` | 返回 config.roles |
| `role:save` | 更新 .module-agent.json 的 roles 数组 |
| `role:delete` | 删除 + cleanupRoleWorkspace() |
| `role:start` | core.roles.startRole(roleConfig) |
| `role:send` | core.roles.sendMessage(roleName, text) |
| `role:cancel/stop` | core.roles.stopRole(roleName) |

### 2. CoreCallbacks → IPC 翻译

```typescript
const callbacks: CoreCallbacks = {
  onStreamChunk: (moduleName, text, type) => {
    mainWindow.webContents.send('agent:stream', { moduleName, text, type });
  },
  onStreamComplete: (moduleName) => {
    // 标记流结束 + 触发 ExperienceSummarizer
  },
  onStreamError: (moduleName, error) => {
    mainWindow.webContents.send('agent:status', { moduleName, status: 'error' });
  },
  onStatusChange: (status) => {
    mainWindow.webContents.send('agent:status', { status });
  },
  onMessage: (message) => {
    mainWindow.webContents.send('agent:message', message);
  },
};
```

### 3. 流式更新转发

`onSessionUpdate` 回调是流式推送的核心：

```
Agent → ACP sessionUpdate
  → launched.onSessionUpdate (由 ElectronBridge 设置)
  → stateManager.appendChunk() → 累加 reply/thinking/tools/timeline
  → mainWindow.webContents.send('agent:stream', {
      moduleName, sessionId, update, data,
      reply, thinking, tools, timeline, sections  // 累加器快照
    })
  → Renderer: agentStore (Pinia) 响应式更新 → 组件渲染
```

### 4. MCP 后端管理

```typescript
this.mcpBackend = new McpBackendServer({
  getAgentEntry: (name) => core.modules.getAgent(name),
  startAgent: (name) => core.modules.startAgent(name),
  sendCrossContext: (src, tgt, dir, phase, content) => {
    mainWindow.webContents.send('agent:cross-context', ...);
  },
  buildPromptBlocks: (name, text) => PromptBuilder.buildPromptBlocks(...),
});
const port = await this.mcpBackend.start();
core.modules.mcpBackendPort = port;  // 注入端口号供 MCP Server 使用
```

### 5. ExperienceSummarizer 触发

每次对话完成后，自动判断是否需要总结：

```typescript
if (summarizationEnabled && chatMsgs.length > threshold) {
  this.summarizer.summarize({ moduleName, chatMsgs, projectRoot, configDir, agentConfig });
}
```

---

## Preload API

`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('moduleAgent', api)` 暴露 API：

```typescript
interface ModuleAgentApi {
  selectDir(title): Promise<string | null>
  scanProject(projectRoot, workspaceRoot): Promise<ScanResult>
  startAgent(moduleName, cmd, args, cwd): Promise<{ sessionId?, error? }>
  sendMessage(moduleName, text): Promise<{ stopReason?, error? }>
  cancelAgent(moduleName): Promise<{}>
  stopAgent(moduleName): Promise<{}>
  isAgentRunning(moduleName): Promise<boolean>
  onAgentStream(callback): () => void           // 返回取消订阅函数
  onAgentStatus(callback): () => void
  onCrossContext(callback): () => void
  // ... 角色、上下文、配置相关 API
}
```

**安全模型**：`contextIsolation: true` + `nodeIntegration: false`，渲染进程无法直接访问 Node.js API。
