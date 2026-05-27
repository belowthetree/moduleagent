# McpBackend & CommunicationBus — MCP 后端与通信总线

> 文件：`src/agents/McpBackend.ts`, `src/protocol/mcp/CommunicationBus.ts`

---

## McpBackendServer — MCP HTTP 后端

**类**：`McpBackendServer`

### 概述

`McpBackendServer` 是一个内嵌 HTTP 服务器，运行在 Electron 主进程中，监听 `127.0.0.1` 的随机端口。它作为 MCP Server 子进程与 Agent 子进程之间的代理，处理跨模块的 `module_call` 和 `module_query` 请求。

### 启动

```typescript
const backend = new McpBackendServer(callbacks);
const port = await backend.start();  // 监听 127.0.0.1:随机端口
```

### McpBackendCallbacks

```typescript
interface McpBackendCallbacks {
  getAgentEntry(moduleName: string): {
    launched: { connection: ClientSideConnection; onSessionUpdate: ... };
    sessionId: string;
  } | undefined;

  startAgent(moduleName: string): Promise<boolean>;      // 自动启动未运行的 Agent
  sendCrossContext?(source, target, direction, phase, content): void; // UI 通知
  buildPromptBlocks(moduleName: string, userText: string): ContentBlock[];
  setAgentStatus?(moduleName: string, status: 'idle' | 'streaming' | 'error'): void;
  onLog?(level: 'info' | 'warn' | 'error', message: string): void;
}
```

### handleRequest(req, res)

处理来自 MCP Server 的 HTTP POST 请求：

```
MCP Server → HTTP POST http://127.0.0.1:{port}
  │
  ├─ 解析 JSON body
  ├─ 路由判断：
  │
  ├─ action: 'module_call' | 'module_query'
  │   ├─ getAgentEntry(targetModule) → 查找目标 Agent
  │   ├─ 不存在 → startAgent(targetModule) → 自动启动
  │   ├─ sendCrossContext('sent', 'request') → UI 通知
  │   ├─ buildPromptBlocks(targetModule, taskText) → 构建 Prompt
  │   ├─ connection.prompt() → 发送给目标 Agent
  │   ├─ 收集流式响应到 chunks[]
  │   ├─ sendCrossContext('sent', 'response') → UI 通知
  │   └─ HTTP 200 { success, result }
  │
  └─ action: 'module_list'
      └─ 直接从 graph 文件返回模块列表
```

### 跨模块通信数据流

```
Agent A (模块 A)
  │ MCP tool: module_call({ targetModule: "B" })
  ▼
MCP Server 子进程
  │ HTTP POST
  ▼
McpBackendServer (Electron 主进程)
  │ → 查找/启动 Agent B
  │ → 发送 Prompt 给 Agent B
  │ → 收集 Agent B 的流式响应
  │ → HTTP 200 返回结果
  ▼
MCP Server → Agent A 的 MCP 工具返回结果
```

---

## CommunicationBus — 通信总线

**类**：`CommunicationBus`

### 概述

`CommunicationBus` 是 MCP Server 内部的模块间通信路由。它管理模块图、执行访问控制检查，并通过 `messageHandler` 回调将跨模块请求发送到 `McpBackendServer`。

### 核心职责

| 职责 | 方法 |
|------|------|
| 模块图管理 | `setModuleGraph(graph)`, `setGraphFile(filePath)` |
| 消息处理注册 | `onMessage(handler)` — 注册 HTTP 转发回调 |
| 模块列表 | `listModules(requestingModule)` — 返回可访问的模块列表 |
| 模块调用 | `callModule(request)` → `messageHandler(request)` → HTTP 后端 |
| 模块查询 | `queryModule(request)` → `messageHandler(request)` → HTTP 后端 |
| 模块创建 | `createModule(request)` → `ModuleGenerator.generate()` |

### 访问控制

`getAccessibleModules(requestingModule)` 限制模块的可见范围：

```
可访问的模块 = 自身 + 子模块 + 父模块
```

```
根模块 → 可访问所有模块
模块 A → 可访问：A + A的子模块 + A的父模块
```

此约束在 `module_call` 和 `module_query` 执行前强制检查。

### 模块调用请求格式

```typescript
interface ModuleCallRequest {
  targetModule: string;          // 目标模块名
  task: string;                  // 结构化任务描述
  context?: Record<string, unknown>;
  requestingModule?: string;     // 请求来源模块
}

interface ModuleCallResult {
  success: boolean;
  result?: string;               // Agent 返回的文本
  error?: string;
}
```
