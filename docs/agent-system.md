# Agent 系统

> 管理 Agent 子进程的完整生命周期：启动、会话、消息、流式累积、取消、停止。

## 文件

| 文件 | 职责 |
|------|------|
| `agent/launcher.rs` | 启动 Agent 子进程，建立 ACP 连接 |
| `agent/manager.rs` | Agent 生命周期编排：启动/停止/发送消息/会话管理，MCP 工具注入 |
| `agent/accumulator.rs` | 流式输出累积：回复、思考、工具调用，实时推送含累积态事件 |
| `agent/prompt.rs` | 提示词构建（当前为透传） |

## AgentLauncher

负责将 `AgentConfig` 转换为 `AcpAgent` 并启动连接。

### 启动流程

```
AgentConfig → build_acp_agent()
  → Windows 下自动包装 cmd.exe /c（继承完整 PATH）
  → AcpAgent::from_args(args)
  
tokio::spawn → 后台任务：
  Client::builder()
    .on_receive_request() → 自动批准权限
    .connect_with(acp_agent, |connection| { ... })
      1. send_request(InitializeRequest) → 初始化连接
      2. conn_tx.send(connection) → 回传连接句柄
      3. cancel.cancelled().await → 等待取消信号
```

### Windows PATH 处理

Windows 上非路径命令（不含 `/` 或 `\`）会自动包装为 `cmd.exe /c <command> <args>`，确保继承系统完整 PATH。

### 日志

```
[INFO]  正在启动 Agent [AgentConfig { command: "opencode", args: Some(["acp"]), ... }]...
[INFO]  [模块生成角色] 发送 ACP initialize 请求 (ProtocolVersion::V1)
[INFO]  [模块生成角色] ACP 初始化响应: V1
[INFO]  ACP 连接初始化成功 [模块生成角色]
[INFO]  Agent 连接已关闭 [模块生成角色]
```

## AgentManager

核心编排器，管理所有运行中的 Agent。

### 状态管理

```rust
agents: RwLock<HashMap<String, AgentEntry>>  // 名称 → Agent 条目
send_locks: Mutex<HashMap<String, SendLock>>  // 名称 → 串行发送锁
```

每个 Agent 条目包含：连接句柄、状态（Idle/Streaming/Error）、生命周期句柄。

### 启动 Agent

```rust
async fn start_agent(name, config, cwd) -> Result<()>
  // 检查重复 → AgentLauncher::launch() → 插入 agents map
```

### 发送消息

```rust
async fn send_message(name, text, project_root) -> Result<StreamAccumulator>
  // 获取 per-agent SendLock → 设置 Streaming 状态
  // → PromptBuilder::build() → run_session()
  // → 恢复 Idle/Error 状态 → 返回累积器
```

### 会话创建（含 MCP 工具注入）

```rust
async fn run_session(name, connection, cwd, prompt) -> Result<StreamAccumulator>
  // 从 self.mcp_tools 克隆 ModuleAgentTools
  // McpServer::from_rmcp("module-agent-tools", || tools.clone())
  // connection.build_session(cwd)
  //   .with_mcp_server(mcp_server)   ← 注入 module_call / module_query / list_modules
  //   .block_task()
  //   .start_session()
  // session.send_prompt(prompt)
  // loop {
  //   match session.read_update() {
  //     SessionMessage → process_dispatch() → 流式累积 + 前端推送
  //     StopReason → 完成
  //     Err → 非 I/O 错误跳过继续，I/O 错误终止
  //   }
  // }
```

每次会话启动时，通过 `with_mcp_server()` 将 `ModuleAgentTools` 注册为 MCP server。
Agent 即可调用 `module_call`、`module_query`、`list_modules` 三个跨模块工具。
`ModuleAgentTools` 内部持有 `Weak<AgentManager>`，调用时 `upgrade` 获取共享引用。

### 错误处理

`read_update()` 的错误处理策略：
- **I/O 错误**（connection closed / broken pipe）→ 终止会话
- **其他错误**（反序列化失败、未知变体如 `usage_update`）→ 记录警告，继续循环

## StreamAccumulator

累积 Agent 流式输出，实时推送到前端。

### 累积态

```rust
pub struct StreamAccumulator {
    pub reply: String,        // 累积回复文本
    pub thinking: String,     // 累积思考文本
    pub tools: String,        // 工具调用概要 "[tool1] [tool2] "
    pub timeline: Vec<TimelineEvent>,  // 交错时间线
    pub stop_reason: Option<String>,
    pub finished: bool,
}
```

### TimelineEvent 序列化

| Rust 变体 | 序列化 JSON | 前端渲染位置 |
|-----------|-------------|-------------|
| `ThoughtChunk { text }` | `{ "type": "thinking", "content": "…" }` | 可折叠"思考"卡片 |
| `ToolCall { title }` | `{ "type": "tool_call", "content": "…" }` | 工具调用行（可展开详情） |

连续 `AgentThoughtChunk` 自动合并到同一 `ThoughtChunk` 条目（`last_mut()` 判尾追加），被其他事件类型（tool_call/reply）打断时新建条目。

### 事件推送

所有 `chunk-*` 事件携带**完整累积态**（非增量 chunk）：

```json
{
  "type": "chunk-reply",
  "data": {
    "reply": "累积回复",
    "thinking": "累积思考",
    "tools": "[read_file] ",
    "timeline": [
      { "type": "thinking", "content": "分析…" },
      { "type": "tool_call", "content": "read_file" }
    ],
    "moduleName": "模块名称"
  }
}
```

前端 stream listener 实时将 `data.reply/thinking/tools/timeline` 写入当前 Agent 占位消息，驱动 UI 流式更新。

### 事件类型调度

| ACP 会话消息 | 前端 emit type | 前端路由 |
|-------------|---------------|---------|
| `AgentMessageChunk` | `chunk-reply` | `onAgentStream` |
| `AgentThoughtChunk` | `chunk-thinking` | `onAgentStream` |
| `ToolCall` | `chunk-tool_call` | `onAgentStream` |
| 其他（UsageUpdate 等） | — | 忽略 |

### 会话结束汇总

```
[INFO] [模块名] 会话结束 — 回复: 1234 字符, 思考: 567 字符, 工具调用: 3 次
```

## PromptBuilder

当前为简单透传（`text.to_string()`）。预留给未来的提示词注入功能：
- 注入系统提示词（`config/mainagentprompt.md`）
- 注入模块上下文
- 首条消息追踪（`sessionPrompted` Set）
