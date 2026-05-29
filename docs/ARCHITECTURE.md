# ModuleAgent 架构分析

> 最后更新: 2026-05-07

## 1. 系统概述

ModuleAgent 是一个**模块化 Agent 编排框架**，以 `module.md` 为模块描述文件，将项目按模块组织，为每个模块启动独立的 Agent 子进程。通过 **ACP 协议**（`@agentclientprotocol/sdk`）通信，通过 **MCP 协议**（`@modelcontextprotocol/sdk`）提供跨模块通信能力。

### 核心能力

- **模块化扫描**：递归扫描 `module.md` 构建模块依赖树
- **独立 Agent 编排**：每个模块对应一个独立的 Agent 子进程
- **跨模块协作**：Agent 之间通过 MCP 工具互相调用/查询
- **角色 Agent**：跨模块的职责化 Agent（文档、架构审查等）
- **工作空间隔离**：为每个 Agent 创建隔离的源码副本

---

## 2. 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (Vue 3)                  │
│  SetupView / MainView / SVGTree / RolePanel / ChatInput     │
│  Pinia stores (config, project, agent)                      │
│  Element Plus UI Library                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  contextBridge API (window.moduleAgent)              │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                   Preload (contextBridge)                    │
│              ipcRenderer → ipcMain 通道桥接                  │
├─────────────────────────────────────────────────────────────┤
│                    Main Process (Electron)                   │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │ IPC 处理器  │  │ AgentOrch-   │  │ RoleAgentManager │     │
│  │ (ipcMain)  │  │ estrator     │  │                  │     │
│  └────────────┘  └──────────────┘  └──────────────────┘     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │ McpBackend │  │ AgentState-  │  │ PromptBuilder    │     │
│  │ (HTTP)     │  │ Manager      │  │ + McpServerBldr  │     │
│  └────────────┘  └──────────────┘  └──────────────────┘     │
├─────────────────────────────────────────────────────────────┤
│               Agent 子进程层 (ACP 协议)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │  ← opencode/claude │
│  │ (模块 A) │  │ (模块 B) │  │ (模块 C) │                   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                   │
│       │              │              │                         │
│  ┌────┴──────────────┴──────────────┴────┐                   │
│  │  MCP Server 子进程 (stdio)              │                   │
│  │  (dist/mcp-server.cjs)                 │                   │
│  │  工具: module_list, module_call,       │                   │
│  │        module_query, create_module     │                   │
│  └────────────────────────────────────────┘                   │
│                                                              │
│  ┌───────────────┐  ┌───────────────┐                       │
│  │ 角色 Agent X  │  │ 角色 Agent Y  │  ← opencode/claude    │
│  │ (role MCP)    │  │ (role MCP)    │                       │
│  └───────────────┘  └───────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 三层架构

| 层级 | 技术栈 | 职责 |
|------|--------|------|
| **渲染进程** | Vue 3 + Element Plus + Pinia | UI 呈现、用户交互、状态管理 |
| **主进程 / TUI** | Electron + TypeScript / Bun + SolidJS | IPC 处理 / 直接调用、Agent 生命周期、MCP 路由、状态持久化 |
| **Core 层** | TypeScript | 统一编排：ModuleAgentCore 管理 MCP 后端、子系统初始化和 session 管理 |
| **Agent 层** | opencode / claude (ACP) + MCP Server | 实际 LLM 推理、模块间通信 |

---

## 3. 进程模型

```
┌──────────────────────────┐     ┌────────────────────────┐
│      Electron Main       │     │   Renderer Process     │
│                          │◄───►│   (Vue 3 SPA)          │
│  PID: 1 (示例)           │ IPC │                        │
│                          │     │   contextBridge API    │
├──────────────────────────┤     └────────────────────────┘
│ AgentOrchestrator        │
│  ├─ AgentEntry A ────────┼──►  Agent A 子进程 (opencode)
│  ├─ AgentEntry B ────────┼──►  Agent B 子进程 (opencode)
│  └─ AgentEntry C ────────┼──►  Agent C 子进程 (opencode)
│                          │
│ McpBackend (HTTP)        │◄──── MCP Server 子进程
│  127.0.0.1:随机端口      │      (dist/mcp-server.cjs)
│                          │
│ RoleAgentManager         │
│  ├─ RoleEntry X ─────────┼──►  角色 Agent X (opencode)
│  │                       │      + mcp-role-server.cjs
│  └─ RoleEntry Y ─────────┼──►  角色 Agent Y (opencode)
│                          │      + mcp-role-server.cjs
└──────────────────────────┘
```

### 进程间通信矩阵

| 源 → 目标 | 协议/机制 | 数据格式 |
|-----------|-----------|----------|
| Renderer → Main | Electron IPC (`ipcMain.handle` / `ipcRenderer.invoke`) | JSON 序列化对象 |
| Main → Renderer | Electron IPC (`webContents.send`) | JSON 序列化对象 |
| Main → Agent | ACP (`ClientSideConnection` via ndJsonStream over stdio) | JSON-RPC 风格通知 |
| Agent → Main | ACP (`Client.sessionUpdate` 等) | JSON-RPC 风格通知 |
| Agent → MCP Server | MCP Stdio (stdio transport) | JSON-RPC (MCP 协议) |
| MCP Server → McpBackend | HTTP POST (`127.0.0.1:port`) | JSON |
| Agent (CLI) → Agent (CLI) | AgentRouter (内存路由) | 函数调用 |

---

## 4. 模块系统

### 4.1 模块定义 (`module.md`)

每个模块由一个 `module.md` 文件定义，使用 YAML frontmatter + Markdown body：

```markdown
---
name: core
description: 核心模块
submodules:
  - name: utils
    path: ./utils
    description: 工具模块
---

# core

## 模块说明
...
```

### 4.2 扫描流程

```
用户项目根目录
  └── .module-agent/
       ├── module/                    # 所有 module.md 存放于此
       │   ├── module.md              # 根模块
       │   ├── src/
       │   │   ├── module.md
       │   │   ├── core/
       │   │   │   └── module.md
       │   │   └── utils/
       │   │       └── module.md
       │   └── config/
       │       └── module.md
       ├── workspace/                 # 隔离工作空间
       │   ├── src/core/              # 模块 A 的源码副本
       │   ├── src/utils/             # 模块 B 的源码副本
       │   └── workrole/              # 角色 Agent 工作空间
       │       └── architect/
       └── context/                   # 对话上下文存储
```

**扫描步骤：**

1. `ModuleScanner.scan()` 递归遍历 `.module-agent/module/`
2. 在每个目录中查找 `module.md`，用 `ModuleParser.parseFile()` 解析
3. `ModuleParser` 用 `gray-matter` 解析 frontmatter，`marked` 解析 body
4. `ModuleGraph.build()` 使用 `submodules` 字段构建树形结构（邻接表）
5. 冲突处理：同名模块按 `relativePath` 重命名（`name` → `relativePath`）

### 4.3 模块图的树结构

```
ModuleGraph {
  root: "my-project",           // 根节点名称
  nodes: Map<string, {          // 邻接表
    name: "my-project",
    relativePath: ".",
    parent: null,
    children: ["src", "config"],
    definition: { frontmatter, body, ... }
  }>
}
```

**访问控制规则**（`CommunicationBus.getAccessibleModules`）：
- 根模块可访问所有模块
- 普通模块可访问：自身 + 子模块 + 父模块
- 这一约束在 `module_call` 和 `module_query` 时强制执行

---

## 5. 通信协议

### 5.1 ACP 协议（Agent Communication Protocol）

使用 `@agentclientprotocol/sdk` v0.20，通过 **ClientSideConnection** 实现主进程与 Agent 子进程的双向通信。

**连接建立流程**（`connection.ts`）：

```
1. spawn(agentCmd, agentArgs)           // 启动 Agent 子进程
2. Readable.toWeb(stdout)               // 子进程 stdout → Web ReadableStream
3. Writable.toWeb(stdin)                // 子进程 stdin → Web WritableStream
4. ndJsonStream(writable, readable)     // 创建 JSON 流
5. new ClientSideConnection(factory, stream)  // SDK 连接
6. connection.initialize({...})         // 握手初始化
```

**Client 接口**（处理 Agent 发起的请求）：

| 方法 | 用途 |
|------|------|
| `requestPermission` | 自动允许所有权限请求 |
| `sessionUpdate` | 接收流式更新（思考/回复/工具调用） |
| `readTextFile` | 读取工作空间文件（`FsHandler`） |
| `writeTextFile` | 写入工作空间文件（`FsHandler`） |
| `createTerminal` | 创建终端子进程（`TerminalHandler`） |
| `terminalOutput` | 获取终端输出 |
| `waitForTerminalExit` | 等待终端退出 |
| `killTerminal` | 杀死终端进程 |
| `releaseTerminal` | 释放终端连接 |

**ACP 会话 API**：

| 方法 | 用途 |
|------|------|
| `connection.initialize()` | 握手初始化 |
| `connection.newSession({ cwd, mcpServers })` | 创建新会话 |
| `connection.prompt({ sessionId, prompt })` | 发送消息/提示 |
| `connection.cancel({ sessionId })` | 取消当前请求 |

### 5.2 MCP 协议（Model Context Protocol）

用于 **Agent 之间的跨模块通信**，采用独立子进程部署 MCP Server。

**架构模式**：

```
Agent A (子进程)
  │
  │ MCP Stdio 协议 (node dist/mcp-server.cjs --graph-file ... --backend-url ...)
  │
  ▼
MCP Server 子进程 (dist/mcp-server.cjs)
  │
  │ module_call → HTTP POST http://127.0.0.1:{port}
  │
  ▼
McpBackendServer (Electron 主进程内嵌 HTTP 服务器)
  │
  │ → getAgentEntry(targetModule) → 找到目标 Agent 连接
  │ → 向目标 Agent 发送 prompt
  │ → 收集流式响应
  │ → 返回结果给 MCP Server
  │
  ▼
Agent B (目标模块子进程)
```

**MCP 工具**：

| 工具 | 功能 | 路由方式 |
|------|------|----------|
| `module_list` | 列出可访问模块 | 直接读取 graph 文件 |
| `module_call` | 向目标模块发任务 | HTTP → McpBackend → 目标 Agent |
| `module_query` | 查询目标模块 | HTTP → McpBackend → 目标 Agent |
| `create_module` | 新建模块 | 直接调用 ModuleGenerator |

### 5.3 角色 Agent MCP

角色 Agent 使用独立的 MCP Server (`dist/mcp-role-server.cjs`)，提供不同的工具集：

| 工具 | 功能 |
|------|------|
| `workrole_read_file` | 读取工作空间文件（安全路径检查） |
| `workrole_write_file` | 写入工作空间文件（安全路径检查） |

角色 Agent **没有**模块间通信工具（不可调用 `module_call` 等）。

---

## 6. Electron IPC 架构

### 6.1 通道分类

**模块 Agent 通道**（Renderer ↔ Main）：

```
类别       通道                      方向         用途
─────     ────                      ────         ────
项目       project:scan              R → M       扫描模块、构建树
           project:getTree           R → M       获取模块树
           project:generateModules   R → M       Agent 自动生成模块
Agent      agent:start               R → M       启动模块 Agent
           agent:send                R → M       发送消息
           agent:cancel              R → M       取消请求
           agent:stop                R → M       停止 Agent
           agent:isRunning           R → M       检查运行状态
           agent:getRunning          R → M       获取所有运行中 Agent
流式推送   agent:stream              M → R       流式更新（思考/回复/工具）
           agent:status              M → R       状态变化
           agent:cross-context       M → R       跨模块通信推送
上下文     context:get               R → M       获取对话历史
           context:clear             R → M       清除对话历史
           context:clearAll          R → M       清除全部
配置       config:save               R → M       保存配置
           config:get                R → M       读取配置
迁移       migrate:check             R → M       检查本地存储迁移
           migrate:data              R → M       执行数据迁移
对话框     dialog:selectDir          R → M       打开目录选择器
```

**角色 Agent 通道**：

```
类别       通道                      方向         用途
─────     ────                      ────         ────
角色       role:list                 R → M       获取角色列表
           role:save                 R → M       保存角色配置
           role:delete               R → M       删除角色
           role:start                R → M       启动角色 Agent
           role:send                 R → M       发送消息
           role:cancel               R → M       取消操作
           role:stop                 R → M       停止角色 Agent
           role:isRunning            R → M       检查运行状态
           role:getContext           R → M       获取角色对话
           role:clearContext         R → M       清除角色对话
流式推送   role:stream               M → R       角色流式更新
           role:status               M → R       角色状态变化
```

### 6.2 Preload API 桥接

`src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('moduleAgent', api)` 暴露统一 API 接口 `ModuleAgentApi`。

**安全模型**：`contextIsolation: true` + `nodeIntegration: false`，渲染进程无法直接访问 Node.js API。

---

## 7. Agent 生命周期

### 7.1 模块 Agent 生命周期（AgentOrchestrator）

```
startAgent(moduleName)
  │
  ├─ 1. _resolveConfig()
  │       → ConfigLoader.load(.module-agent.json)
  │       → 模块特定配置 > 默认配置
  │
  ├─ 2. graph.nodes.get(moduleName)
  │       → 获取模块节点信息
  │
  ├─ 3. _resolveCwd()
  │       → prepareModuleWorkspace() 复制源码到隔离目录
  │       → 返回隔离工作空间路径
  │
  ├─ 4. getSubModuleDirs()
  │       → 获取子模块工作空间路径（用于 FsHandler 路由）
  │
  ├─ 5. launcher.launch()
  │       → spawn Agent 子进程
  │       → ClientSideConnection.initialize()
  │       → 返回 LaunchedAgent
  │
  ├─ 6. Wire onSessionUpdate callback
  │       → 流式内容转发到 Renderer
  │
  ├─ 7. buildMcpServers()
  │       → 构建 MCP Server 子进程配置
  │
  ├─ 8. connection.newSession({ cwd, mcpServers })
  │       → Agent 连接 MCP Server
  │       → 返回 sessionId
  │
  ├─ 9. sessionPrompted.delete(moduleName)
  │       → 下次发送消息时注入系统提示
  │
  └─ 10. Store AgentEntry { name, config, launched, sessionId }
```

### 7.2 角色 Agent 生命周期（RoleAgentManager）

```
startRoleAgent(role)
  │
  ├─ 1. prepareRoleWorkspace()
  │       → 创建 workrole/<name>/
  │       → 复制 visibleModulePaths 中每个模块的源码
  │       → 排除 node_modules, .git
  │
  ├─ 2. launcher.launch()
  │       → spawn Agent 子进程（无 subModuleDirs）
  │
  ├─ 3. Wire onSessionUpdate callback
  │
  ├─ 4. _buildRoleMcpServers(workspacePath)
  │       → 使用 dist/mcp-role-server.cjs
  │       → 工具: workrole_read_file, workrole_write_file
  │
  ├─ 5. connection.newSession({ cwd, mcpServers })
  │
  └─ 6. Store RoleAgentEntry
```

### 7.3 消息发送流程

```
sendMessage(moduleName, text)
  │
  ├─ 1. dedupMessage() 检查重复消息
  ├─ 2. sendLock mutex (per-module 串行化)
  ├─ 3. Auto-start Agent 如果未运行
  ├─ 4. buildPromptBlocks()
  │      ├─ 首次消息: 系统提示 (mainagentprompt.md/subagentprompt.md)
  │      │            + 模块上下文 (module.md body)
  │      │            + 用户消息
  │      └─ 后续消息: 仅用户消息
  ├─ 5. stateManager.startStream() 初始化流累加器
  ├─ 6. connection.prompt() → Agent 开始推理
  ├─ 7. Agent 回复通过 onSessionUpdate → agent:stream → Renderer
  ├─ 8. stateManager.finishStream() 完成累加
  ├─ 9. saveContext() 持久化对话
  └─10. 返回结果 { reply, thinking, tools, stopReason }
```

### 7.4 流式输出通道

```
Agent 子进程
  │ sessionUpdate 通知 (ACP)
  ▼
ClientSideConnection → Client.sessionUpdate()
  │
  ▼
launched.onSessionUpdate(name, sessionId, notification)
  │
  ▼
mainWindow.webContents.send('agent:stream', {
  moduleName, sessionId,
  update: 'agent_message_chunk' | 'agent_thought_chunk' | 'tool_call',
  data: { content: { type, text } },
  reply, thinking, tools  // 累加器快照
})
  │
  ▼
Renderer: preload onAgentStream callback
  │
  ▼
agentStore (Pinia) 更新状态
  │ SVGTree.vue / NodeDetailPanel.vue 响应式更新
```

---

## 8. 关键设计模式

### 8.1 依赖注入（AgentOrchestrator）

`AgentOrchestrator` 通过构造函数注入四个协作对象：

```typescript
new AgentOrchestrator({
  launcher,              // AgentLauncher — 启动子进程 + ACP 连接
  workspaceIsolator,     // WorkspaceIsolator — 工作空间管理
  promptBuilder,         // PromptBuilder — 系统提示构建
  mcpServerBuilder,      // McpServerBuilder — MCP 服务器配置
  ...
})
```

这种设计使得：
- **可测试性**：每个协作对象可单独 mock
- **职责分离**：启动、隔离、提示构建、MCP 配置互不耦合
- **Electron/CLI 共享**：CLI 路径可复用相同接口

### 8.2 累加器模式（AgentStateManager）

流式响应使用 `StreamAccumulator` 累加：

```typescript
StreamAccumulator {
  reply: string;      // agent_message_chunk 累加
  thinking: string;   // agent_thought_chunk 累加
  tools: string;      // tool_call 累加
  sections: { thinking, tools, reply };  // 节标记
  finished?: boolean;
}
```

流状态生命周期：`startStream()` → `appendChunk()` (N次) → `finishStream()` / `cancelStream()` / `stopStream()`

### 8.3 发送锁（Send Lock）

每个模块/角色 Agent 的发送操作使用 `Promise` 串行化：

```typescript
const prevLock = sendLock.get(moduleName);
if (prevLock) await prevLock;  // 等待前一次完成

const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
sendLock.set(moduleName, lockPromise);
try { ... } finally { resolveLock(); sendLock.delete(moduleName); }
```

### 8.4 去重机制（Dedup）

```typescript
// 检查最近发送的相同消息（防重复提交）
if (dedupMessage(lastSent, moduleName, text)) {
  return { error: 'duplicate message ignored' };
}
```

### 8.5 首次消息注入

通过 `sessionPrompted` Set 跟踪：

```typescript
if (!sessionPrompted.has(moduleName)) {
  sessionPrompted.add(moduleName);
  blocks.push(系统提示);
  blocks.push(模块上下文);
}
blocks.push(用户消息);  // 首次与后续均包含
```

---

## 9. 数据流全景

### 9.1 应用启动时序

```
app.whenReady()
  │
  ├─ Menu.setApplicationMenu(null)    // 隐藏默认菜单
  ├─ registerIpcHandlers()            // 注册所有 IPC
  │
  └─ createWindow()
       │
       ├─ new BrowserWindow({ preload, contextIsolation })
       ├─ loadFile/index.html
       │
       └─ Renderer: onMounted()
            ├─ 自动扫描 project:scan
            │   ├─ ModuleScanner.scan()
            │   ├─ ModuleGraph.build()
            │   ├─ AgentOrchestrator 初始化
            │   ├─ McpBackendServer.start() → 随机端口
            │   └─ RoleAgentManager 初始化
            ├─ 监听 agent:status/agent:stream/role:stream
            └─ 就绪
```

### 9.2 用户发送消息时序

```
用户输入 → ChatInput.vue @send
  │
  ├─ agentStore.sendMessage(moduleName, text)
  │   ├─ 立即 push 用户消息到 contextMap（即时 UI 反馈）
  │   ├─ window.moduleAgent.sendMessage(moduleName, text)
  │   │   ├─ ipcRenderer.invoke('agent:send', ...)
  │   │       └─ Main: agent:send handler
  │   │           ├─ dedupMessage()
  │   │           ├─ sendLock mutex
  │   │           ├─ orchestrator.startAgent() (if needed)
  │   │           ├─ buildPromptBlocks()
  │   │           ├─ stateManager.startStream()
  │   │           ├─ connection.prompt()
  │   │           │    └─ Agent 开始推理
  │   │           │       ├─ sessionUpdate(agent_thought_chunk) ──→ agent:stream
  │   │           │       ├─ sessionUpdate(tool_call) ──→ agent:stream
  │   │           │       │   └─ FsHandler.readFile/writeFile
  │   │           │       │   └─ TerminalHandler.createTerminal
  │   │           │       ├─ sessionUpdate(agent_message_chunk) ──→ agent:stream
  │   │           │       └─ (持续到 stopReason)
  │   │           ├─ stateManager.finishStream()
  │   │           ├─ saveContext()
  │   │           └─ return { reply, thinking, tools, stopReason }
  │   └─ push agent 消息到 contextMap
  │
  └─ NodeDetailPanel.vue 响应式更新对话
```

### 9.3 跨模块通信时序

```
Agent A (模块 A) → MCP Server
  │ module_call({ targetModule: "模块B", goal: "...", ... })
  │
  ▼
MCP Server → McpBackendServer (HTTP POST)
  │ { targetModule: "模块B", task: "...", requestingModule: "模块A" }
  │
  ▼
McpBackendServer.handleRequest()
  ├─ getAgentEntry("模块B")
  │   └─ 不存在 → startAgent("模块B") 自动启动
  ├─ sendCrossContext("模块A", "模块B", "sent", "request", ...)
  │   └─ agent:cross-context → Renderer
  ├─ 临时替换 onSessionUpdate 以收集完整响应
  ├─ connection.prompt() → Agent B 推理
  ├─ 收集流式回复到 chunks[]
  │   └─ agent:stream → Renderer（累加器继续工作）
  ├─ sendCrossContext("模块B", "模块A", "sent", "response", ...)
  ├─ 恢复 onSessionUpdate
  └─ HTTP 200 { success, result }
      │
      ▼
MCP Server → Agent A
  │ 工具执行完成，返回结果
```

---

## 10. 构建架构

### 10.1 构建工具链

```
electron-vite (pnpm run dev / pnpm run build:electron 第一步)
  ├─ src/main/      → out/main/index.cjs    (esbuild, CJS)
  ├─ src/preload/   → out/preload/index.cjs (esbuild, CJS)
  └─ src/renderer/  → out/renderer/         (Vite, 含 Vue SFC)

esbuild (后续步骤)
  ├─ build:mcp-server      → dist/mcp-server.cjs      (自包含 CJS)
  ├─ build:mcp-role-server → dist/mcp-role-server.cjs (自包含 CJS)
  └─ build:cli             → dist/cli.cjs             (自包含 CJS, external @opentui/*)
```

### 10.2 产物依赖关系

```
out/main/index.cjs
  ├─ electron (external)
  ├─ @agentclientprotocol/sdk (external)
  ├─ @modelcontextprotocol/server (external)
  ├─ zod (external)
  ├─ fs-extra, gray-matter, marked, simple-git (external)
  └─ 引用 src/core/, src/agents/, src/config/, src/protocol/acp/

dist/mcp-server.cjs      ← 自包含 bundle, 所有依赖内联
dist/mcp-role-server.cjs ← 自包含 bundle, 所有依赖内联
dist/cli.cjs             ← 自包含 bundle, external @opentui/core @opentui/solid @opentui/keymap
```

### 10.3 配置体系

```
.module-agent.json (用户项目根目录)
  │
  ├─ agents.default.command/args    → 默认 Agent 命令
  ├─ agents.modules                 → 模块特定 Agent 覆盖
  ├─ exclude                        → 扫描排除规则
  ├─ projectPath                    → 项目源码根目录
  └─ roles[]                        → 角色 Agent 配置
       ├─ name
       ├─ description
       ├─ visibleModulePaths
       └─ agents.default

ConfigLoader 加载流程：
  .module-agent.json → Zod schema 校验 → ConfigLoader.getDefaultConfig() → ProjectConfig
```

---

## 11. 双路径架构（Electron + CLI）

项目维护**两套平行的 Agent 生命周期管理**：

| 方面 | Electron 路径（主要） | CLI 路径（次要） |
|------|---------------------|------------------|
| 入口 | `src/main/index.ts` | `src/cli/index.ts` |
| Agent 管理 | `AgentOrchestrator` | `AgentManager` + `AgentRouter` |
| 消息路由 | IPC → Main → Agent | `AgentRouter` 内存路由 |
| 配置消费 | `MainView.vue` → IPC → ConfigLoader | `src/tui/services/AgentService.ts` |
| 流式推送 | `agent:stream` IPC 通道 | `StreamHandler` 转发到 Ink/OpenTUI |
| UI | Vue 3 SFC + Element Plus | Ink (React) / OpenTUI (Solid) |
| 状态管理 | Pinia stores | Ink 组件状态 |
| 构建 | `pnpm run build:electron` | `pnpm run build:cli` |

共享的层：
- `AgentLauncher`（子进程启动 + ACP 连接）
- `ModuleScanner` / `ModuleParser`
- `ModuleGraph`
- `ConfigLoader` / schema / defaults
- 协议层（`src/protocol/acp/`）

---

## 12. 安全模型

| 层面 | 机制 |
|------|------|
| 渲染进程隔离 | `contextIsolation: true`, `nodeIntegration: false` |
| 文件系统隔离 | `FsHandler` 限制在 `cwd + subModuleDirs` 范围内；`RoleMCPServer` 做路径前缀检查防止目录穿越 |
| 跨模块访问控制 | `CommunicationBus.checkAccess()` 限制模块间通信为父子关系 |
| CSP | 在 `session.defaultSession.webRequest.onHeadersReceived()` 中设置，非 HTML meta 标签 |
| 权限管理 | `Client.requestPermission` 自动允许所有请求 |

---

## 13. 关键文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/main/index.ts` | ~886 | Electron 主进程入口，IPC 处理器，全局编排 |
| `src/preload/index.ts` | ~113 | contextBridge API 定义 |
| `src/agents/AgentLauncher.ts` | ~109 | Agent 子进程启动 + ACP 连接 |
| `src/agents/AgentOrchestrator.ts` | ~326 | 模块 Agent 生命周期编排 |
| `src/agents/RoleAgentManager.ts` | ~221 | 角色 Agent 生命周期管理 |
| `src/agents/RoleWorkspace.ts` | ~73 | 角色 Agent 工作空间准备 |
| `src/agents/AgentStateManager.ts` | ~176 | 流累加器 + 上下文持久化 |
| `src/agents/WorkspaceIsolator.ts` | ~164 | 模块工作空间隔离复制 |
| `src/agents/McpBackend.ts` | ~229 | MCP HTTP 后端服务器 |
| `src/agents/McpServerBuilder.ts` | ~60 | MCP Server 配置构建 |
| `src/agents/PromptBuilder.ts` | — | 系统提示 + 模块上下文构建 |
| `src/protocol/acp/connection.ts` | ~109 | ACP 连接建立 (spawn + ndJsonStream) |
| `src/protocol/acp/handlers/fs.ts` | — | 工作空间文件读写 |
| `src/protocol/acp/handlers/terminal.ts` | — | 终端子进程管理 |
| `src/protocol/mcp/MCPServer.ts` | ~147 | MCP Server (模块 Agent 4 工具) |
| `src/protocol/mcp/RoleMCPServer.ts` | ~91 | MCP Server (角色 Agent 2 工具) |
| `src/protocol/mcp/CommunicationBus.ts` | ~249 | 消息路由总线 + 访问控制 |
| `src/core/ModuleScanner.ts` | ~79 | 递归扫描 module.md |
| `src/core/ModuleGraph.ts` | ~157 | 构建模块树 + 冲突处理 |
| `src/core/ModuleParser.ts` | — | 解析 frontmatter + Markdown |
| `src/core/ModuleGenerator.ts` | — | 自动生成 module.md |
| `src/config/ConfigLoader.ts` | — | 加载 .module-agent.json |
| `src/config/schema.ts` | — | Zod schema 定义 |
| `src/config/defaults.ts` | — | 默认配置 + TypeScript 类型 |
| `src/renderer/src/stores/agent.ts` | ~359 | Pinia Agent 状态 |
| `src/renderer/src/stores/project.ts` | ~104 | Pinia 项目状态 |
| `src/renderer/src/views/MainView.vue` | ~647 | 主界面布局 + 交互 |
| `src/renderer/src/components/SVGTree.vue` | — | 交互式 SVG 模块树 |
| `src/renderer/src/components/NodeDetailPanel.vue` | — | 模块详情 + 对话 |
| `src/renderer/src/components/RolePanel.vue` | — | 角色 Agent 卡片列表 |
| `src/types/module.ts` | ~42 | 模块类型定义 |
| `src/types/preload.ts` | ~158 | Preload API 类型 + ChatMsg 等 |

---

## 14. 架构决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| Agent 通信协议 | ACP (`@agentclientprotocol/sdk`) | 与 opencode Agent 原生兼容，支持流式、文件系统、终端 |
| 跨模块通信 | MCP + HTTP Backend | 标准协议，Agent 天然支持；HTTP 层做路由和自动启动 |
| UI 框架 | Vue 3 + Element Plus | 轻量、响应式、与 electron-vite 整合良好 |
| 状态管理 | Pinia | Vue 3 官方推荐，TypeScript 支持好 |
| 模块定义 | `module.md` + frontmatter | 人类可读，Agent 可直接读写 |
| 工作空间隔离 | 源码复制 | 每个 Agent 获得独立上下文，互不干扰 |
| 构建工具 | electron-vite + esbuild | electron-vite 统一三进程构建，esbuild 为 MCP/CLI 做自包含 bundle |
| 角色 Agent MCP | 独立 server 进程 | 与模块 Agent MCP 解耦，提供不同工具集 |

---

## 15. 文档索引

完整的模块文档列表：

### 核心层 (Core)
| 文档 | 覆盖模块 |
|------|---------|
| [MODULE_AGENT_SUBSYSTEM.md](./MODULE_AGENT_SUBSYSTEM.md) | ModuleAgentSubsystem — 模块 Agent 生命周期管理 |
| [ROLE_AGENT_SUBSYSTEM.md](./ROLE_AGENT_SUBSYSTEM.md) | RoleAgentSubsystem — 角色 Agent 生命周期管理 |
| [WORKFLOW_SUBSYSTEM.md](./WORKFLOW_SUBSYSTEM.md) | WorkflowSubsystem + WorkflowScanner — 工作流编排 |
| [MODULE_SYSTEM.md](./MODULE_SYSTEM.md) | ModuleScanner + ModuleParser + ModuleGraph + ModuleGenerator |
| [LOGGER.md](./LOGGER.md) | Logger — 日志系统 |
| [EXPERIENCE_SUMMARIZER.md](./EXPERIENCE_SUMMARIZER.md) | ExperienceSummarizer — 对话经验总结 |
| [PATH_UTILS.md](./PATH_UTILS.md) | PathUtils + ExclusionRules — 路径工具与排除规则 |

### Agent 层
| 文档 | 覆盖模块 |
|------|---------|
| [AGENT_LAUNCHER.md](./AGENT_LAUNCHER.md) | AgentLauncher + AgentStateManager — Agent 启动与状态管理 |
| [PROMPT_BUILDER.md](./PROMPT_BUILDER.md) | PromptBuilder + McpServerBuilder — 提示构建与 MCP 配置 |
| [ROLE_AGENT.md](./ROLE_AGENT.md) | RoleAgentManager + RoleWorkspace — 角色 Agent 管理 |
| [WORKFLOW_AGENTS.md](./WORKFLOW_AGENTS.md) | WorkflowManager + WorkflowWorkspace — 工作流 Agent 管理 |
| [WORKSPACE_ISOLATOR.md](./WORKSPACE_ISOLATOR.md) | WorkspaceIsolator — 工作空间隔离 |
| [CONTEXT_MANAGER.md](./CONTEXT_MANAGER.md) | ContextManager + FileStore — 对话上下文持久化 |

### 协议层 (Protocol)
| 文档 | 覆盖模块 |
|------|---------|
| [MCP_BACKEND.md](./MCP_BACKEND.md) | McpBackend + CommunicationBus — MCP 后端与通信总线 |
| [MCP_SERVER.md](./MCP_SERVER.md) | MCPServer + RoleMCPServer — MCP 服务端 |
| [ACP协议文档.md](./ACP协议文档.md) | ACP 协议规范 |

### 桥接层 (Bridge)
| 文档 | 覆盖模块 |
|------|---------|
| [ELECTRON_BRIDGE.md](./ELECTRON_BRIDGE.md) | ElectronBridge + preload — Electron IPC 桥接 |
| [TUI_BRIDGE.md](./TUI_BRIDGE.md) | TuiBridge — TUI SolidJS 桥接 |

### 配置与 CLI
| 文档 | 覆盖模块 |
|------|---------|
| [CONFIG_SYSTEM.md](./CONFIG_SYSTEM.md) | ConfigPaths + ConfigLoader + schema + defaults |
| [CLI.md](./CLI.md) | CLI 命令系统 |

### 设计文档
| 文档 | 内容 |
|------|------|
| [DESIGN.md](./DESIGN.md) | 原始设计方案 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发指南（构建、调试、已知问题） |
| [MODULE_FORMAT.md](./MODULE_FORMAT.md) | module.md 格式规范 |
| [CLI_PROTOCOL.md](./CLI_PROTOCOL.md) | CLI 通信协议 |
| [OPENTUI_DOCS.md](./OPENTUI_DOCS.md) | OpenTUI 框架文档 |
| [项目方案.md](./项目方案.md) | 项目方案
