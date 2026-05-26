# Agent 系统

> 管理 Agent 子进程的完整生命周期：启动、会话、消息、流式累积、取消、停止。

## 文件

| 文件 | 职责 |
|------|------|
| `agent/launcher.rs` | 启动 Agent 子进程，建立 ACP 连接 |
| `agent/manager.rs` | Agent 生命周期编排：启动/停止/发送消息/会话管理 |
| `agent/accumulator.rs` | 流式输出累积：回复、思考、工具调用 |
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

### 会话循环

```rust
async fn run_session(name, connection, cwd, prompt) -> Result<StreamAccumulator>
  // session.start_session()
  // session.send_prompt(prompt)
  // loop {
  //   match session.read_update() {
  //     SessionMessage → process_dispatch() → 流式累积 + 前端推送
  //     StopReason → 完成
  //     Err → 非 I/O 错误跳过继续，I/O 错误终止
  //   }
  // }
```

### 错误处理

`read_update()` 的错误处理策略：
- **I/O 错误**（connection closed / broken pipe）→ 终止会话
- **其他错误**（反序列化失败、未知变体如 `usage_update`）→ 记录警告，继续循环

## StreamAccumulator

累积 Agent 流式输出，实时推送到前端。

### 事件类型

| 变体 | 处理 | 前端事件 |
|------|------|----------|
| `AgentMessageChunk` | 追加到 reply，记录时间线 | `chunk-reply` |
| `AgentThoughtChunk` | 追加到 thinking | `chunk-thinking` |
| `ToolCall` | 追加到 tools，记录时间线 | `chunk-tool_call` |
| 其他（UsageUpdate 等） | 忽略 | — |

### 会话结束汇总

```
[INFO] [模块名] 会话结束 — 回复: 1234 字符, 思考: 567 字符, 工具调用: 3 次
```

## PromptBuilder

当前为简单透传（`text.to_string()`）。预留给未来的提示词注入功能：
- 注入系统提示词（`config/mainagentprompt.md`）
- 注入模块上下文
- 首条消息追踪（`sessionPrompted` Set）
