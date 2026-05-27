# ModuleAgentSubsystem — 模块 Agent 子系统

> 文件：`src/core/ModuleAgentSubsystem.ts` | 类：`ModuleAgentSubsystem`

## 概述

`ModuleAgentSubsystem` 是模块 Agent 生命周期的完整管理者。它由 `ModuleAgentCore` 创建，负责从配置加载到 Agent 启动、消息发送、跨模块通信的整个流程。

## 核心职责

1. **初始化**：加载项目配置 → 扫描模块 → 构建模块图 → 加载系统提示 → 写入 MCP 图文件
2. **Agent 启动**：解析模块 Agent 配置 → 准备隔离工作空间 → 启动子进程 → 建立 ACP 连接 → 注入 MCP 服务器
3. **消息发送**：路由消息 → 去重检查 → 构建 Prompt → 发送 ACP 请求 → 收集流式响应
4. **生命周期管理**：启动/停止/取消 Agent，管理 `agents` Map

## 关键类型

```typescript
export interface AgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;     // 来自 AgentLauncher
  sessionId: string;
  modulePath: string;
  capabilities?: AgentCapabilities;
}
```

## 生命周期

### init(projectRoot)

```
1. ConfigLoader.load(projectRoot)
   → 加载 .module-agent.json，获取 AgentConfig + exclude 规则

2. ModuleScanner.scan({ projectRoot: .module-agent/module/ })
   → 递归扫描 module.md 文件

3. new ModuleGraph().build(descriptors, projectRoot)
   → 构建模块依赖树

4. writeMcpGraphFile(graph, os.tmpdir())
   → 将模块图序列化为临时 JSON 文件（供 MCP Server 读取）

5. loadSystemPrompts(configDir)
   → 加载 config/knowledge/mainagentprompt.md 和 subagentprompt.md
```

返回 `InitResult { moduleNames, rootAgent }`。

### startAgent(moduleName)

```
1. resolveAgentConfig(moduleName)
   → 检查 agents.modules 覆盖 > agents.default

2. 检查 agents/pendingStarts Map → 去重

3. _startAgentInternal(moduleName)
   a. 从 graph.nodes 获取模块节点
   b. prepareModuleWorkspace(node, { workspaceRoot, projectPath, graph })
      → 复制模块源码到隔离工作空间
   c. getSubModuleDirs(node, graph, workspacePathForModule)
      → 获取子模块路径（用于 FsHandler 跨模块文件访问）
   d. agentLauncher.launch(config, moduleName, cwd, logger, { subModuleDirs })
      → spawn Agent 子进程 + 建立 ACP 连接
   e. Wire onSessionUpdate → 转发流式更新
   f. buildMcpServers({ moduleName, basePath, backendPort, graphFile })
      → 构建 MCP Server 子进程配置
   g. connection.newSession({ cwd, mcpServers })
      → 创建 ACP 会话，注入 MCP 服务器
   h. sessionPrompted.delete(moduleName)
      → 重置首次消息标记
   i. 存入 agents Map
```

### sendMessage(moduleName, text)

```
1. _routeMessage(text)
   → 按 @name 关键词或路径匹配路由到目标模块

2. dedupMessage(lastSent, moduleName, text)
   → 3 秒内相同消息去重

3. sendLock mutex
   → 按模块串行化发送

4. startAgent(moduleName) → 自动启动（若未运行）

5. buildPromptBlocks({ moduleName, userText, graph, prompts, sessionPrompted })
   → 首次消息：系统提示 + 模块上下文 + patterns + experience
   → 后续消息：仅用户消息

6. connection.prompt({ sessionId, prompt: blocks })
   → 发送到 ACP Agent

7. 流式响应通过 onSessionUpdate → CoreCallbacks.onStreamChunk
```

### stopAgent / dispose

- `stopAgent(moduleName)`: kill 子进程，从 agents Map 删除
- `dispose()`: 停止所有 Agent，清理状态

## 关键设计

### 发送锁 (Send Lock)

每个模块使用 Promise 链式串行化发送操作，防止并发消息错乱：

```typescript
const prevLock = sendLock.get(moduleName);
if (prevLock) await prevLock;
// ... 执行发送 ...
sendLock.delete(moduleName);
```

### 首次消息注入

通过 `sessionPrompted` Set 跟踪每个模块 session 是否已注入系统提示。`startAgent` 时清除标记，确保新 session 的首次消息包含完整上下文。

### 消息路由

`_routeMessage(text)` 方法识别两种路由模式：
- **关键词路由**：`@moduleName message` → 路由到 `moduleName`
- **路径路由**：根据文件路径所属模块路由

如果不匹配任何路由，默认使用 `currentModule`（用户当前选中的模块）。

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，创建并持有 `ModuleAgentSubsystem` 实例 |
| `AgentLauncher` | 内部创建，用于启动 Agent 子进程 |
| `ModuleScanner` / `ModuleGraph` | 初始化时调用，构建模块图 |
| `ConfigLoader` | 加载 `.module-agent.json` 配置 |
| `PromptBuilder` | 构建发送给 Agent 的 Prompt |
| `McpServerBuilder` | 构建 MCP Server 配置注入到 Agent session |
| `WorkspaceIsolator` | 准备模块隔离工作空间 |
| `McpBackendServer` | 通过 HTTP 代理跨模块 MCP 调用 |
