# Agent Client Protocol (ACP) 协议文档

> 来源: https://agentclientprotocol.com  
> 整理日期: 2026-04-27

---

## 目录

1. [简介](#1-简介)
2. [架构设计](#2-架构设计)
3. [通信模型](#3-通信模型)
4. [传输层](#4-传输层)
5. [协议生命周期](#5-协议生命周期)
   - 5.1 [初始化阶段](#51-初始化阶段)
   - 5.2 [会话建立](#52-会话建立)
   - 5.3 [Prompt 回合](#53-prompt-回合)
6. [核心概念](#6-核心概念)
   - 6.1 [内容块 (Content Blocks)](#61-内容块-content-blocks)
   - 6.2 [工具调用 (Tool Calls)](#62-工具调用-tool-calls)
   - 6.3 [Agent 计划 (Agent Plan)](#63-agent-计划-agent-plan)
   - 6.4 [权限请求 (Permission Request)](#64-权限请求-permission-request)
7. [客户端能力](#7-客户端能力)
   - 7.1 [文件系统 (File System)](#71-文件系统-file-system)
   - 7.2 [终端 (Terminals)](#72-终端-terminals)
8. [会话管理](#8-会话管理)
   - 8.1 [会话模式 (Session Modes)](#81-会话模式-session-modes)
   - 8.2 [会话配置选项 (Session Config Options)](#82-会话配置选项-session-config-options)
   - 8.3 [斜杠命令 (Slash Commands)](#83-斜杠命令-slash-commands)
   - 8.4 [会话列表 (Session List)](#84-会话列表-session-list)
9. [扩展机制](#9-扩展机制)
10. [所有方法与通知一览](#10-所有方法与通知一览)
11. [MCP 集成](#11-mcp-集成)

---

## 1. 简介

**Agent Client Protocol (ACP)** 是一个标准化代码编辑器/IDE 与 AI 编程 Agent 之间通信的协议，适用於本地和远程场景。

### 为什么需要 ACP？

- **集成开销**: 每个新的 Agent-编辑器组合都需要定制开发
- **兼容性受限**: Agent 只能与部分编辑器配合工作
- **开发者锁定**: 选择某个 Agent 往往意味着必须接受其可用的接口

ACP 类似于 [LSP (Language Server Protocol)](https://microsoft.github.io/language-server-protocol/) 标准化了语言服务器集成，它标准化了 Agent-编辑器通信。实现 ACP 的 Agent 可以与任何兼容的编辑器配合使用。

### 适用场景

- **本地 Agent**: 作为代码编辑器的子进程运行，通过 stdio 上的 JSON-RPC 通信
- **远程 Agent**: 可托管在云端或独立基础设施上，通过 HTTP 或 WebSocket 通信（远程 Agent 的完整支持仍在开发中）

### 默认文本格式

用户可读文本的默认格式为 **Markdown**，提供足够的灵活性来表示富文本格式，而不要求编辑器支持 HTML 渲染。

---

## 2. 架构设计

### 设计原则

1. **MCP 友好**: 基于 JSON-RPC，尽可能复用 MCP 类型
2. **UX 优先**: 专为解决 AI Agent 交互的 UX 挑战而设计
3. **可信赖**: 用户通过代码编辑器与可信的模型通信，同时保持对 Agent 工具调用的控制

### 架构概览

```
┌──────────────┐     JSON-RPC (stdio/HTTP)     ┌──────────────┐
│              │◄────────────────────────────►│              │
│   客户端      │   请求: initialize, session/*  │   Agent      │
│  (IDE/编辑器) │   通知: session/update         │  (AI 程序)   │
│              │   请求: fs/*, terminal/*        │              │
└──────┬───────┘                               └──────┬───────┘
       │                                              │
       │ MCP 配置                                      │ MCP 连接
       ▼                                              ▼
┌──────────────┐                               ┌──────────────┐
│  MCP Servers │                               │  MCP Servers │
│  (用户配置)   │                               │  (Agent 连接) │
└──────────────┘                               └──────────────┘
```

- 客户端作为子进程启动 Agent，所有通信通过 stdin/stdout 进行
- 每个连接可以支持**多个并发会话**，可以有多个思维线程同时进行
- 协议大量使用 JSON-RPC 通知来实现实时流式更新
- 双向请求允许 Agent 向编辑器发起请求（如权限请求）

---

## 3. 通信模型

协议遵循 [JSON-RPC 2.0](https://www.jsonrpc.org/specification) 规范，包含两种消息类型：

- **方法 (Methods)**: 请求-响应对，期望返回 result 或 error
- **通知 (Notifications)**: 单向消息，不期望响应

### 参数约定

- 所有文件路径**必须**是绝对路径
- 行号从 **1** 开始计数

### 错误处理

遵循标准 JSON-RPC 2.0 错误处理：
- 成功响应包含 `result` 字段
- 错误响应包含 `error` 对象，含 `code` 和 `message`
- 通知永远不接收响应（无论成功或失败）

---

## 4. 传输层

ACP 使用 UTF-8 编码的 JSON-RPC 消息。当前定义的传输机制：

### stdio（标准）

- 客户端作为父进程启动 Agent 子进程
- Agent 从 `stdin` 读取 JSON-RPC 消息，向 `stdout` 发送消息
- 消息以换行符 (`\n`) 分隔，消息内部**不得**包含换行符
- Agent 可以向 `stderr` 写入日志，客户端可选择捕获、转发或忽略
- Agent **不得**向 `stdout` 写入非 ACP 消息的内容
- 客户端**不得**向 Agent 的 `stdin` 写入非 ACP 消息的内容

### Streamable HTTP（草案阶段）

正在讨论中，尚未稳定。

### 自定义传输

Agent 和客户端可以实现额外的自定义传输机制，但**必须**保持 JSON-RPC 消息格式和 ACP 生命周期要求。

---

## 5. 协议生命周期

### 消息流程总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 初始化阶段                                                     │
│    客户端 → Agent: initialize (版本协商 + 能力交换)                │
│    客户端 → Agent: authenticate (若 Agent 要求认证)                │
├─────────────────────────────────────────────────────────────────┤
│ 2. 会话建立                                                       │
│    客户端 → Agent: session/new (创建新会话)                        │
│    或 客户端 → Agent: session/load (恢复已有会话，需 loadSession 能力)│
│    或 客户端 → Agent: session/resume (恢复已有会话，不重放历史)      │
├─────────────────────────────────────────────────────────────────┤
│ 3. Prompt 回合                                                    │
│    客户端 → Agent: session/prompt (发送用户消息)                   │
│    Agent → 客户端: session/update (进度更新通知，可能多次)          │
│    Agent → 客户端: session/request_permission (权限请求)           │
│    客户端 → Agent: session/cancel (取消操作，通知)                  │
│    Agent → 客户端: session/prompt 响应 (含 stopReason)             │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 初始化阶段

在建立会话之前，客户端**必须**调用 `initialize` 方法。

#### 请求参数

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      },
      "terminal": true
    },
    "clientInfo": {
      "name": "my-client",
      "title": "My Client",
      "version": "1.0.0"
    }
  }
}
```

#### 响应

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "promptCapabilities": {
        "image": true,
        "audio": true,
        "embeddedContext": true
      },
      "mcpCapabilities": {
        "http": true,
        "sse": true
      }
    },
    "agentInfo": {
      "name": "my-agent",
      "title": "My Agent",
      "version": "1.0.0"
    },
    "authMethods": []
  }
}
```

#### 协议版本协商

- `protocolVersion` 是一个整数，标识**主**协议版本，仅在引入破坏性变更时递增
- 客户端请求中包含其支持的最新协议版本
- 若 Agent 支持该版本，则响应相同版本；否则响应其支持的最新版本
- 若客户端不支持 Agent 返回的版本，应关闭连接并通知用户

#### 能力 (Capabilities)

所有能力声明都是**可选的**。省略的能力视为**不支持**。

##### 客户端能力

| 能力 | 类型 | 说明 |
|------|------|------|
| `fs.readTextFile` | boolean | `fs/read_text_file` 方法可用 |
| `fs.writeTextFile` | boolean | `fs/write_text_file` 方法可用 |
| `terminal` | boolean | 所有 `terminal/*` 方法可用 |

##### Agent 能力

| 能力 | 类型 | 说明 |
|------|------|------|
| `loadSession` | boolean | `session/load` 方法可用 |
| `promptCapabilities.image` | boolean | prompt 可包含 Image 内容块 |
| `promptCapabilities.audio` | boolean | prompt 可包含 Audio 内容块 |
| `promptCapabilities.embeddedContext` | boolean | prompt 可包含 Resource 内容块 |
| `mcpCapabilities.http` | boolean | Agent 支持通过 HTTP 连接 MCP 服务器 |
| `mcpCapabilities.sse` | boolean | Agent 支持通过 SSE 连接 MCP 服务器(已废弃) |
| `sessionCapabilities.close` | {} | `session/close` 方法可用 |
| `sessionCapabilities.resume` | {} | `session/resume` 方法可用 |
| `sessionCapabilities.list` | {} | `session/list` 方法可用 |

**基线要求**: 所有 Agent **必须**支持 `ContentBlock::Text` 和 `ContentBlock::ResourceLink`。

#### 认证

如果 Agent 要求认证，会在 `authMethods` 中公布支持的认证方法。客户端在创建会话前调用 `authenticate`。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "authenticate",
  "params": {
    "methodId": "oauth2"
  }
}
```

### 5.2 会话建立

#### 创建新会话

```json
// 请求
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/new",
  "params": {
    "cwd": "/home/user/project",
    "mcpServers": [
      {
        "name": "filesystem",
        "command": "/path/to/mcp-server",
        "args": ["--stdio"],
        "env": []
      }
    ]
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "sess_abc123def456"
  }
}
```

**参数说明**:
- `cwd`: 会话的工作目录，**必须**是绝对路径
- `mcpServers`: Agent 应连接的 MCP 服务器列表

#### 加载已有会话

需要 `loadSession` 能力。Agent **必须**通过 `session/update` 通知重放整个会话历史，之后才能响应 `session/load` 请求。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/load",
  "params": {
    "sessionId": "sess_789xyz",
    "cwd": "/home/user/project",
    "mcpServers": [...]
  }
}
```

#### 恢复已有会话

需要 `sessionCapabilities.resume` 能力。与 `session/load` 不同，Agent **不得**重放历史消息，仅恢复会话上下文。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/resume",
  "params": {
    "sessionId": "sess_789xyz",
    "cwd": "/home/user/project",
    "mcpServers": [...]
  }
}
```

#### 关闭会话

需要 `sessionCapabilities.close` 能力。Agent 必须取消所有进行中的工作（如同调用 `session/cancel`），然后释放资源。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/close",
  "params": {
    "sessionId": "sess_789xyz"
  }
}
```

### 5.3 Prompt 回合

一个 Prompt 回合代表完整的交互循环，从用户消息开始，到 Agent 完成响应结束。可能涉及多次语言模型调用和工具执行。

#### 生命周期步骤

1. **用户消息** - 客户端发送 `session/prompt`
2. **Agent 处理** - Agent 将消息发送给语言模型
3. **Agent 报告输出** - Agent 通过 `session/update` 通知发送内容块、工具调用等
4. **检查完成** - 若无待处理的工具调用，回合结束，返回 `stopReason`
5. **工具调用** - Agent 可选择请求权限，然后执行工具，报告进度和结果
6. **继续对话** - 工具结果返回给语言模型，循环回到步骤 2

#### 发送 Prompt

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123def456",
    "prompt": [
      {
        "type": "text",
        "text": "Can you analyze this code for potential issues?"
      },
      {
        "type": "resource",
        "resource": {
          "uri": "file:///home/user/project/main.py",
          "mimeType": "text/x-python",
          "text": "def process_data(items):\n    for item in items:\n        print(item)"
        }
      }
    ]
  }
}
```

#### Agent 报告输出 (session/update)

`session/update` 通知可以包含以下类型的更新：

| sessionUpdate 值 | 说明 |
|---|---|
| `user_message_chunk` | 用户消息块 |
| `agent_message_chunk` | Agent 消息块 |
| `thought_message_chunk` | 思考消息块 |
| `tool_call` | 新工具调用 |
| `tool_call_update` | 工具调用状态更新 |
| `plan` | 执行计划 |
| `available_commands_update` | 可用命令更新 |
| `current_mode_update` | 当前模式变更 |
| `config_option_update` | 配置选项更新 |
| `session_info_update` | 会话信息更新 |

#### Stop Reasons（停止原因）

| 值 | 说明 |
|---|---|
| `end_turn` | 语言模型完成响应，无需更多工具 |
| `max_tokens` | 达到最大 token 限制 |
| `max_turn_requests` | 单回合模型请求次数超限 |
| `refusal` | Agent 拒绝继续 |
| `cancelled` | 客户端取消了回合 |

#### 取消操作

客户端可在任何时间发送 `session/cancel` 通知来取消正在进行的回合：

```json
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": {
    "sessionId": "sess_abc123def456"
  }
}
```

- 客户端发送取消后应**预先**将所有未完成的工具调用标记为 `cancelled`
- 客户端**必须**对所有待处理的 `session/request_permission` 响应 `cancelled`
- Agent 收到后应尽快停止所有 LLM 请求和工具调用
- Agent **必须**在原始 `session/prompt` 请求的响应中返回 `cancelled` stopReason
- 协议库抛出的异常不应作为错误返回，Agent **必须**捕获并返回 `cancelled`

---

## 6. 核心概念

### 6.1 内容块 (Content Blocks)

内容块代表在协议中流动的可显示信息。它们出现在：
- 用户通过 `session/prompt` 发送的 prompt 中
- 通过 `session/update` 通知流式传输的 LLM 输出中
- 工具调用的进度更新和结果中

ACP 使用与 MCP 相同的 `ContentBlock` 结构，使 Agent 能够无缝转发 MCP 工具输出。

#### Text 内容（基线支持）

```json
{
  "type": "text",
  "text": "What's the weather like today?"
}
```

所有 Agent **必须**支持 Text 内容块。

#### Image 内容（需 image 能力）

```json
{
  "type": "image",
  "mimeType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
}
```

#### Audio 内容（需 audio 能力）

```json
{
  "type": "audio",
  "mimeType": "audio/wav",
  "data": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB..."
}
```

#### 嵌入资源（需 embeddedContext 能力）

这是将上下文包含在 Prompt 中的**首选方式**，特别是使用 @-提及引用文件时。允许包含 Agent 可能无法直接访问的源内容。

```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///home/user/script.py",
    "mimeType": "text/x-python",
    "text": "def hello():\n    print('Hello, world!')"
  }
}
```

#### 资源链接

引用 Agent 可以访问的资源（不嵌入内容）。

```json
{
  "type": "resource_link",
  "uri": "file:///home/user/document.pdf",
  "name": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000
}
```

### 6.2 工具调用 (Tool Calls)

工具调用代表语言模型要求 Agent 执行的操作。Agent 通过 `session/update` 通知报告工具调用。

#### 创建工具调用

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "call_001",
      "title": "Reading configuration file",
      "kind": "read",
      "status": "pending"
    }
  }
}
```

#### 工具类型 (Tool Kinds)

| 值 | 说明 |
|---|---|
| `read` | 读取文件或数据 |
| `edit` | 修改文件或内容 |
| `delete` | 删除文件或数据 |
| `move` | 移动或重命名文件 |
| `search` | 搜索信息 |
| `execute` | 运行命令或代码 |
| `think` | 内部推理或规划 |
| `fetch` | 获取外部数据 |
| `other` | 其他类型（默认） |

#### 工具状态 (Status)

| 值 | 说明 |
|---|---|
| `pending` | 尚未开始运行（等待输入流完成或审批） |
| `in_progress` | 正在运行 |
| `completed` | 成功完成 |
| `failed` | 执行失败 |

#### 工具内容类型

1. **常规内容** - 标准内容块（text, image, resource 等）
2. **Diff** - 文件修改显示为 diff：
   ```json
   {
     "type": "diff",
     "path": "/home/user/project/src/config.json",
     "oldText": "{\"debug\": false}",
     "newText": "{\"debug\": true}"
   }
   ```
3. **终端** - 实时终端输出：
   ```json
   {
     "type": "terminal",
     "terminalId": "term_xyz789"
   }
   ```

#### 工具位置追踪

工具调用可以报告正在操作的文件位置，使客户端实现"跟随"功能：

```json
{
  "path": "/home/user/project/src/main.py",
  "line": 42
}
```

### 6.3 Agent 计划 (Agent Plan)

计划是复杂任务的执行策略，Agent 可通过 `session/update` 通知分享给客户端。

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "plan",
      "entries": [
        {
          "content": "Analyze the existing codebase structure",
          "priority": "high",
          "status": "pending"
        },
        {
          "content": "Identify components that need refactoring",
          "priority": "high",
          "status": "pending"
        }
      ]
    }
  }
}
```

**条目属性**:
- `content`: 任务的可读描述
- `priority`: `high` | `medium` | `low`
- `status`: `pending` | `in_progress` | `completed`

**更新计划**: Agent **必须**在每次更新中发送完整的条目列表。客户端**必须**完全替换当前计划。计划可以在执行过程中动态演变。

### 6.4 权限请求 (Permission Request)

Agent 在执行工具调用前可以向用户请求权限：

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess_abc123def456",
    "toolCall": {
      "toolCallId": "call_001"
    },
    "options": [
      {
        "optionId": "allow-once",
        "name": "Allow once",
        "kind": "allow_once"
      },
      {
        "optionId": "reject-once",
        "name": "Reject",
        "kind": "reject_once"
      }
    ]
  }
}
```

**权限选项类型 (PermissionOptionKind)**:
- `allow_once` - 仅此次允许
- `allow_always` - 允许并记住选择
- `reject_once` - 仅此次拒绝
- `reject_always` - 拒绝并记住选择

**客户端响应**:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

若回合被取消，客户端**必须**返回 `"cancelled"` 结果：
```json
{
  "outcome": {
    "outcome": "cancelled"
  }
}
```

---

## 7. 客户端能力

### 7.1 文件系统 (File System)

#### 读取文件 `fs/read_text_file`

```json
// 请求
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "fs/read_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/src/main.py",
    "line": 10,
    "limit": 50
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": "def hello_world():\n    print('Hello, world!')\n"
  }
}
```

参数: `sessionId` (必填), `path` (必填, 绝对路径), `line` (可选, 起始行), `limit` (可选, 最大行数)

#### 写入文件 `fs/write_text_file`

```json
// 请求
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "fs/write_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/config.json",
    "content": "{\"debug\": true,\"version\": \"1.0.0\"}"
  }
}
```

客户端**必须**在文件不存在时创建文件。

### 7.2 终端 (Terminals)

终端方法允许 Agent 在客户端环境中执行 shell 命令。

#### 创建终端 `terminal/create`

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "terminal/create",
  "params": {
    "sessionId": "sess_abc123def456",
    "command": "npm",
    "args": ["test", "--coverage"],
    "env": [{"name": "NODE_ENV", "value": "test"}],
    "cwd": "/home/user/project",
    "outputByteLimit": 1048576
  }
}

// 响应 (立即返回，不等待命令完成)
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "terminalId": "term_xyz789"
  }
}
```

#### 获取输出 `terminal/output`

```json
// 响应示例
{
  "output": "Running tests...\n✓ All tests passed (42 total)\n",
  "truncated": false,
  "exitStatus": {
    "exitCode": 0,
    "signal": null
  }
}
```

#### 等待退出 `terminal/wait_for_exit`

阻塞直到命令执行完成，返回 `exitCode` 和 `signal`。

#### 终止命令 `terminal/kill`

终止命令但**不释放**终端，之后仍可调用 `terminal/output` 和 `terminal/wait_for_exit`。

#### 释放终端 `terminal/release`

终止命令（若仍在运行）并释放资源。释放后终端 ID 对所有 `terminal/*` 方法无效。

#### 内置超时模式

1. 用 `terminal/create` 创建终端
2. 启动超时计时器
3. 并发等待计时器触发或 `terminal/wait_for_exit` 返回
4. 若超时先到：调用 `terminal/kill`，然后 `terminal/output`，将输出发送给模型
5. 调用 `terminal/release`

---

## 8. 会话管理

### 8.1 会话模式 (Session Modes)

> **注意**: Session Config Options 已取代此功能，模式方法将在未来版本中移除。

Agent 可以提供一组操作模式，影响系统提示词、工具可用性和权限行为。

**在会话建立时返回**:
```json
{
  "modes": {
    "currentModeId": "ask",
    "availableModes": [
      {"id": "ask", "name": "Ask", "description": "请求权限后再做任何修改"},
      {"id": "architect", "name": "Architect", "description": "设计和规划，不实现"},
      {"id": "code", "name": "Code", "description": "编写和修改代码，全部工具可用"}
    ]
  }
}
```

**从客户端切换**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/set_mode",
  "params": {
    "sessionId": "sess_abc123def456",
    "modeId": "code"
  }
}
```

**从 Agent 切换**: Agent 发送 `current_mode_update` 通知。

### 8.2 会话配置选项 (Session Config Options)

**推荐使用**。Agent 可提供任意配置选项列表，用于模型选择、模式、推理级别等。

```json
{
  "configOptions": [
    {
      "id": "mode",
      "name": "Session Mode",
      "category": "mode",
      "type": "select",
      "currentValue": "ask",
      "options": [
        {"value": "ask", "name": "Ask", "description": "请求权限后修改"},
        {"value": "code", "name": "Code", "description": "完整工具访问"}
      ]
    },
    {
      "id": "model",
      "name": "Model",
      "category": "model",
      "type": "select",
      "currentValue": "model-1",
      "options": [
        {"value": "model-1", "name": "Model 1", "description": "最快模型"},
        {"value": "model-2", "name": "Model 2", "description": "最强模型"}
      ]
    }
  ]
}
```

**语义类别**:
| 类别 | 说明 |
|------|------|
| `mode` | 会话模式选择器 |
| `model` | 模型选择器 |
| `thought_level` | 推理级别选择器 |

**设置配置选项**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/set_config_option",
  "params": {
    "sessionId": "sess_abc123def456",
    "configId": "mode",
    "value": "code"
  }
}
```

响应**始终**包含完整配置状态。Agent 也可通过 `config_option_update` 通知主动更新。

### 8.3 斜杠命令 (Slash Commands)

Agent 可以通过 `available_commands_update` 通知公布可用的斜杠命令：

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "available_commands_update",
      "availableCommands": [
        {
          "name": "web",
          "description": "Search the web for information",
          "input": {"hint": "query to search for"}
        },
        {
          "name": "test",
          "description": "Run tests for the current project"
        }
      ]
    }
  }
}
```

命令在 Prompt 中以文本形式发送：
```json
{
  "prompt": [{"type": "text", "text": "/web agent client protocol"}]
}
```

命令可以在会话期间动态更新。

### 8.4 会话列表 (Session List)

需要 `sessionCapabilities.list` 能力。

```json
// 请求
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/list",
  "params": {
    "cwd": "/home/user/project",
    "cursor": "eyJwYWdlIjogMn0="
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123def456",
        "cwd": "/home/user/project",
        "title": "Implement session list API",
        "updatedAt": "2025-10-29T14:22:15Z"
      }
    ],
    "nextCursor": "eyJwYWdlIjogM30="
  }
}
```

使用**游标分页**，`cursor` 和 `nextCursor` 为不透明令牌。可通过 `cwd` 按工作目录过滤。

**会话信息更新**: Agent 可通过 `session_info_update` 通知实时更新会话元数据（标题、标签等）。

---

## 9. 扩展机制

### `_meta` 字段

协议中所有类型都包含 `_meta` 字段 (`{ [key: string]: unknown }`)，实现可以附加自定义信息。

保留用于 W3C Trace Context 的根级键：
- `traceparent`
- `tracestate`
- `baggage`

实现**不得**在规范定义的类型的根级别添加自定义字段，所有可能的名称保留给未来协议版本。

### 扩展方法

任何以下划线 (`_`) 开头的方法名保留给自定义扩展。

**自定义请求**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "_zed.dev/workspace/buffers",
  "params": {"language": "rust"}
}
```

如果接收端不识别该方法，应返回标准 "Method not found" 错误 (`-32601`)。

**自定义通知**:
```json
{
  "jsonrpc": "2.0",
  "method": "_zed.dev/file_opened",
  "params": {"path": "/home/user/project/src/editor.rs"}
}
```

对未识别的自定义通知，实现**应**忽略。

### 公布自定义能力

在能力对象的 `_meta` 字段中公布：

```json
{
  "agentCapabilities": {
    "loadSession": true,
    "_meta": {
      "zed.dev": {
        "workspace": true,
        "fileNotifications": true
      }
    }
  }
}
```

---

## 10. 所有方法与通知一览

### Agent 端方法（客户端调用）

| 方法 | 类型 | 说明 | 必需 |
|------|------|------|------|
| `initialize` | 请求 | 版本协商与能力交换 | 是 |
| `authenticate` | 请求 | 认证（若 Agent 要求） | 条件 |
| `session/new` | 请求 | 创建新会话 | 是 |
| `session/prompt` | 请求 | 发送用户 Prompt | 是 |
| `session/cancel` | 通知 | 取消进行中的操作 | 是 |
| `session/load` | 请求 | 加载已有会话（重放历史） | 需能力 |
| `session/resume` | 请求 | 恢复已有会话（不重放历史） | 需能力 |
| `session/close` | 请求 | 关闭活跃会话 | 需能力 |
| `session/list` | 请求 | 列出已知会话 | 需能力 |
| `session/set_mode` | 请求 | 设置会话模式 | 可选 |
| `session/set_config_option` | 请求 | 设置配置选项 | 可选 |

### 客户端端方法（Agent 调用）

| 方法 | 类型 | 说明 | 必需 |
|------|------|------|------|
| `session/request_permission` | 请求 | 请求用户授权工具调用 | 是 |
| `fs/read_text_file` | 请求 | 读取文件内容 | 需能力 |
| `fs/write_text_file` | 请求 | 写入文件内容 | 需能力 |
| `terminal/create` | 请求 | 创建终端并执行命令 | 需能力 |
| `terminal/output` | 请求 | 获取终端输出 | 需能力 |
| `terminal/wait_for_exit` | 请求 | 等待终端命令退出 | 需能力 |
| `terminal/kill` | 请求 | 终止终端命令（不释放） | 需能力 |
| `terminal/release` | 请求 | 释放终端 | 需能力 |

### 通知（Agent → 客户端）

| 通知方法 | 说明 |
|----------|------|
| `session/update` | 会话更新（内容块、工具调用、计划、命令、模式、配置等） |

---

## 11. MCP 集成

ACP 深度集成了 [Model Context Protocol (MCP)](https://modelcontextprotocol.io)，在会话建立时客户端将 MCP 服务器配置传递给 Agent。

### 传输类型

#### Stdio 传输（所有 Agent 必须支持）

```json
{
  "name": "filesystem",
  "command": "/path/to/mcp-server",
  "args": ["--stdio"],
  "env": [
    {"name": "API_KEY", "value": "secret123"}
  ]
}
```

#### HTTP 传输（需 `mcpCapabilities.http`）

```json
{
  "type": "http",
  "name": "api-server",
  "url": "https://api.example.com/mcp",
  "headers": [
    {"name": "Authorization", "value": "Bearer token123"}
  ]
}
```

#### SSE 传输（需 `mcpCapabilities.sse`，已被 MCP 规范废弃）

### 编辑器自提供 MCP 工具

编辑器也可将自己作为 MCP 服务器提供给 Agent。若 Agent 仅支持 stdio 传输，编辑器可提供一个小型代理，将请求隧道回自身。

```
┌─────────┐  MCP via stdio  ┌──────────────┐  ACP  ┌─────────┐
│  Agent  │◄───────────────►│  MCP-Proxy   │◄────►│  Editor │
└─────────┘                 └──────────────┘       └─────────┘
```

---

> 本文档基于 https://agentclientprotocol.com 的公开文档整理，完整规范以官方文档为准。
