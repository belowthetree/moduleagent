# AgentLauncher & AgentStateManager — Agent 启动与状态管理

> 文件：`src/agents/AgentLauncher.ts`, `src/agents/AgentStateManager.ts`

---

## AgentLauncher — Agent 启动器

**类**：`AgentLauncher`

### 概述

`AgentLauncher` 负责启动 Agent 子进程、建立 ACP 连接、注册客户端处理器（文件系统、终端、权限、流式更新），是所有 Agent（模块、角色、工作流步骤）的统一启动入口。

### launch(config, name, cwd, logger?, options?)

```
AgentLauncher.launch()
  │
  ├─ cwd.replace(/\\/g, '/')                  // Windows 路径归一化
  │
  ├─ new FsHandler(cwd, subModuleDirs)        // 文件系统处理器
  ├─ new TerminalHandler(cwd)                 // 终端处理器
  │
  ├─ clientFactory = (): Client => ({         // ACP Client 接口
  │     requestPermission: 自动允许所有权限请求
  │     sessionUpdate:      转发流式更新到 onSessionUpdate
  │     readTextFile:       FsHandler.readFile
  │     writeTextFile:      FsHandler.writeFile
  │     createTerminal:     TerminalHandler.create
  │     terminalOutput/kill/release: TerminalHandler.*
  │   })
  │
  ├─ createAgentConnection({ command, args, env, cwd }, clientFactory)
  │   → spawn 子进程 + ndJsonStream + ClientSideConnection
  │
  ├─ connection.initialize({ protocolVersion: 1, clientCapabilities, clientInfo })
  │   → 握手，获取 Agent 能力集
  │
  └─ 返回 LaunchedAgent { connection, process, name, cwd, agentCapabilities, onSessionUpdate }
```

### AgentConfig

```typescript
interface AgentConfig {
  command: string;              // Agent 可执行文件（如 'opencode', 'claude'）
  args?: string[];              // 命令行参数（如 ['acp']）
  env?: Record<string, string>; // 额外环境变量
}
```

### LaunchedAgent

```typescript
interface LaunchedAgent {
  connection: ClientSideConnection;
  process: ChildProcess;
  name: string;
  cwd: string;
  agentCapabilities?: AgentCapabilities;
  onSessionUpdate: ((moduleName: string, sessionId: string, update: SessionNotification) => void) | null;
}
```

---

## AgentStateManager — Agent 状态管理器

**类**：`AgentStateManager`

### 概述

`AgentStateManager` 管理 Agent 的流式状态和对话上下文的持久化。它在主进程（Electron）中运行，接收 ACP 的 `sessionUpdate` 通知并累加成结构化状态。

### StreamAccumulator — 流累加器

```typescript
interface StreamAccumulator {
  reply: string;           // agent_message_chunk 累加
  thinking: string;        // agent_thought_chunk 累加
  tools: string;           // tool_call 累加
  timeline: TimelineEvent[]; // 时间线事件（思考/工具调用按时间排序）
  finished?: boolean;
  sections: {
    thinking: boolean;     // 是否有思考内容
    tools: boolean;        // 是否有工具调用
    reply: boolean;        // 是否有回复
  };
}
```

### 流式生命周期

```
startStream(moduleName)
  → 创建空 StreamAccumulator

appendChunk(moduleName, updateType, data)
  → agent_message_chunk: 累加 reply（文本块）或 thinking（thinking 类型块）
  → agent_thought_chunk: 累加 thinking
  → tool_call: 累加 tools + timeline（按 toolCallId 更新或新增）
  → plan: 追加计划标记

finishStream(moduleName)  → 标记 finished = true，返回累加器
cancelStream(moduleName)  → 同上（取消也是一种结束）
stopStream(moduleName)    → 从 Map 中删除流状态
```

### 上下文持久化

| 方法 | 说明 |
|------|------|
| `saveContext(moduleName, msgs)` | 保存到 `.module-agent/contexts/<moduleName>.json`（原子写入：先写 .tmp 再 rename） |
| `loadContext(moduleName)` | 从 JSON 文件恢复 ChatMsg[] |
| `clearContext(moduleName)` | 删除单个模块的上下文文件 |
| `clearAllContexts()` | 清除所有上下文文件 |

### 时间线事件

```typescript
interface TimelineEvent {
  type: 'thinking' | 'tool_call';
  content: string;
  toolCallId?: string;     // 工具调用时使用，用于更新状态
}
```

时间线的关键行为是**合并**：连续的 `thinking` 事件合并为一个条目，相同 `toolCallId` 的工具调用更新现有条目而非追加。

---

## 关键消费者

- **ElectronBridge**：主要消费者，在 `onSessionUpdate` 回调中调用 `appendChunk` 进行累加，并通过 IPC 推送 `agent:stream` 到渲染进程
- **TuiBridge**：通过 `CoreCallbacks.onStreamChunk` 直接获取文本块，不经过 AgentStateManager
