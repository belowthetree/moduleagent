# TuiBridge — TUI 桥接层

> 文件：`src/tui/bridge.ts` | 类：`TuiBridge` | 最后更新: 2026-06-03

## 概述

`TuiBridge` 是 TUI（终端用户界面）模式下连接 Core 层和 SolidJS UI 的桥接适配器。它同时管理 **模块 Agent**、**角色 Agent** 和 **工作流** 三个子系统的生命周期，并通过 `CoreCallbacks` 和 session update 回调将流式响应翻译为 SolidJS 信号更新。

## 架构位置

```
┌──────────────────────────────────────────────────┐
│  TUI Renderer (SolidJS)                          │
│  ┌────────────────────────────────────────────┐  │
│  │ tuiState.messages()  — 消息列表             │  │
│  │ tuiState.agentStatus() — 当前状态           │  │
│  │ tuiState.currentTarget() — module/role/wf   │  │
│  │ tuiState.showThought() — 思考可见性         │  │
│  │ tuiState.inputHistory() — 输入历史          │  │
│  │ tuiState.activeCounts() — M/R/W 计数        │  │
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  TuiBridge                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ ModuleAgentCore                            │  │
│  │  ├── ModuleAgentSubsystem  ← 模块 Agent    │  │
│  │  ├── RoleAgentSubsystem    ← 角色 Agent    │  │
│  │  └── WorkflowSubsystem     ← 工作流引擎    │  │
│  │                                            │  │
│  │ TuiPersistence             ← 对话持久化    │  │
│  │ InputHistoryPersistence    ← 输入历史      │  │
│  │ ExperienceSummarizer       ← 经验总结      │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 子系统管理

### 初始化流程

```
init(projectRoot)
  ├── ModuleAgentCore.initAll(projectRoot)
  │     ├── 扫描模块、构建图
  │     ├── 加载系统提示词
  │     ├── initRoles + initWorkflows (auto)
  │     └── startMcpBackend()               → HTTP 后端 (跨模块通信)
  ├── TuiPersistence(projectRoot)           → 初始化持久化
  ├── InputHistoryPersistence.load()        → 恢复输入历史
  └── persistence.load(rootAgent)           → 恢复上次对话
```

### Agent 启动与 Session 管理

```
启动 Agent 时:
  ├── 检查 .module-agent/sessions/{name}.json → 读取上次 sessionId
  ├── 检查 Agent 是否支持 sessionCapabilities.resume
  ├── 支持 → connection.resumeSession({ sessionId, cwd, mcpServers })  ← 恢复上下文
  └── 不支持 → connection.newSession({ cwd, mcpServers })               ← 新建会话
```

### 三目标系统（module / role / workflow）

`tuiState.currentTarget()` 决定消息路由目标：

| target | 路由方法 | 消息发送 |
|--------|---------|---------|
| `module` | `core.sendMessage(text)` | → ModuleAgentSubsystem |
| `role` | `core.roles.sendMessage(name, text)` | → RoleAgentSubsystem |
| `workflow` | `core.workflows.executeWorkflow(name, text)` | → WorkflowSubsystem |

## 核心设计

### 流式消息类型系统

`onStreamChunk` 回调接收 `type: 'message' | 'thought'`，TuiBridge 分别追加到独立的流式消息：

```typescript
// CoreCallbacks
onStreamChunk: (moduleName, text, type) => {
  if (type === 'message') {
    appendToStreamMsg(currentReplyMsgId, text, 'agent_reply');
  } else if (type === 'thought') {
    appendToStreamMsg(currentThoughtMsgId, text, 'agent_thought');
  }
}
```

消息类型枚举 (`MessageType`):

| msgType | 图标 | 颜色 | 说明 |
|---------|------|------|------|
| `user` | 👤 | 绿色 | 用户输入 |
| `agent_reply` | 🤖 | 默认 | Agent 回复 |
| `agent_thought` | 💭 | 灰色 | Agent 思考过程（可折叠） |
| `tool_call` | 🔧 | 金色 | 工具调用 |
| `system` | ℹ️ | 灰色 | 系统通知 |
| `cross_context` | 🔗 | 蓝色 | 跨模块通信 |

### 多子系统 session update 转发

```typescript
// ModuleAgentCore 构造时注入三个子系统回调:
{
  onSessionUpdate:      // → 模块 Agent session 更新
  onRoleSessionUpdate:  // → 角色 Agent session 更新 (agent_message_chunk/thought/tool_call)
  onWorkflowSessionUpdate: // → 工作流 session 更新
}
```

### 消息生命周期

```
用户输入
  → 创建 user 消息
  → 创建 agent_reply 消息 (空内容)
  → 创建 agent_thought 消息 (空内容)
  → 发送到目标子系统
  → onStreamChunk/onSessionUpdate:
      'message' → replyMsg.content += text
      'thought' → thoughtMsg.content += text
      'tool_call' → 创建 tool_call 消息
  → onStreamComplete:
      标记 replyMsg + thoughtMsg 完成
  → autoSave() (debounced 2s)
```

### 状态跟踪

```typescript
moduleStatuses: Map<string, AgentStatus>  // 模块名 → idle|streaming|error
roleStatuses:   Map<string, AgentStatus>  // 角色名 → idle|streaming|error
```

### 对话持久化

- **保存**: `TuiPersistence.save(moduleName, messages)` → `.module-agent/tui_sessions/{name}.json`
- **加载**: `TuiPersistence.load(moduleName)` → 恢复消息列表，启动时自动加载 rootAgent 历史
- **自动保存**: 每次对话完成后立即保存
- **命令**: `/save [name]` 手动保存，`/load [name]` 手动加载
- **清除**: `/clear` 同时删除对话文件和 session 记录（下次启动创建新会话）
- **切换模块**: `/mode` 自动加载目标模块的历史对话

### 输入历史

- **存储**: `InputHistoryPersistence` → `.module-agent/tui_input_history.json`
- **容量**: 最多 200 条，自动去重
- **导航**: ↑ 键回退，↓ 键前进
- **持久化**: 每次提交后后台异步保存

## 与 ElectronBridge 的差异

| 特性 | ElectronBridge | TuiBridge |
|------|---------------|-----------|
| 通信机制 | Electron IPC (`ipcMain.handle`) | 直接函数调用 |
| 状态管理 | Pinia stores (Vue 3) | SolidJS signals |
| 流式累加 | AgentStateManager | 按 msgType 分别累加 |
| 角色 Agent | 9 个 IPC 通道 | 直接调用 RoleAgentSubsystem |
| 工作流 | 9 个 IPC 通道 | 直接调用 WorkflowSubsystem |
| MCP 后端 | McpBackendServer (HTTP) | McpBackendServer (Core 自动启动) |
| 对话持久化 | AgentStateManager + FileStore | TuiPersistence |
| 输入历史 | 浏览器原生 | InputHistoryPersistence |
| 跨模块通信通知 | IPC cross-context 推送 | 系统消息 |

## 命令系统

### 模块命令
- `/list` — 列出所有模块
- `/tree` — 交互式模块树面板（↑↓←→ 导航，Enter 切换，Esc 关闭）
- `/rescan` — 重新扫描模块
- `/get <name>` — 查看模块详情
- `/mode <id>` — 切换模块 Agent（自动加载历史 + 启动 Agent）

### 角色命令
- `/role list` — 列出所有角色
- `/role start <name>` — 启动角色 Agent
- `/role stop <name>` — 停止角色 Agent
- `/role cancel` — 取消当前角色操作

### 工作流命令
- `/workflow list` — 列出所有工作流
- `/workflow run <name>` — 执行工作流
- `/workflow status` — 查看执行状态（步骤进度 + 结果）
- `/workflow cancel` — 取消执行

### 其他命令
- `/thought` — 切换思考内容可见性
- `/status` — 显示 M/R/W 子系统状态
- `/save [name]` — 保存当前对话
- `/load [name]` — 加载历史对话
- `/clear` — 清空上下文
- `/setup` — 重新配置项目
- `/help` — 显示帮助
- `/quit` — 退出 TUI

## 组件架构

```
App.tsx
├── SetupWizard        (screen === 'setup')
└── (screen === 'chat')
    ├── ContextArea     — 消息列表（按 msgType 分类渲染）
    ├── CommandPalette  — / 命令候选面板（动态过滤）
    ├── InputBox        — 输入框 + 历史导航
    └── StatusBar       — 状态栏（target: status | M:N R:N W:N | cwd）
```

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/tui/bridge.ts` | 桥接核心：三子系统管理 + 流式路由 + 持久化 |
| `src/tui/renderer.tsx` | OpenTUI 渲染器启动 + globalThis 钩子 |
| `src/tui/state.ts` | SolidJS 响应式状态（14 个信号） |
| `src/tui/types.ts` | TUI 类型定义（MessageType, ChatMessage 等） |
| `src/tui/commands.ts` | 命令系统（17 条命令，含角色/工作流） |
| `src/tui/persistence.ts` | 对话 + 输入历史持久化 |
| `src/tui/config.ts` | 配置读写 helper |
| `src/tui/App.tsx` | 主布局组件 + Ctrl+P diff 快捷键 + Y/R/N 全局键 |
| `src/tui/components/ContextArea.tsx` | 消息列表（按 msgType 渲染，支持文本选择） |
| `src/tui/components/InputBox.tsx` | 输入框 + 历史导航 + 粘贴处理 |
| `src/tui/components/StatusBar.tsx` | 状态栏（agent 状态 + cwd 路径） |
| `src/tui/components/CommandPalette.tsx` | / 命令候选面板 + 子命令推荐 |
| `src/tui/components/SetupWizard.tsx` | 设置向导（命令→模型→参数→项目目录→确认） |
| `src/tui/components/ModuleTree.tsx` | 交互式模块树面板 |
| `src/tui/components/DiffBar.tsx` | 工作区变更底部固定条（Y/R/N） |
| `src/tui/components/DiffPanel.tsx` | Diff 面板（文件列表 + unified diff 详情） |
| `src/tui/cjk.ts` | CJK 字符宽度计算工具 |

## 新增功能

### 工作区 Diff

Agent 响应完成后自动对比工作区（`.module-agent/workspace/` 或 `.module-agent/module/`）与源目录。有变更时在消息区底部显示 DiffBar，支持：
- `Y` 接受全部变更并写回源目录
- `R` 打开 DiffPanel 逐文件审查
- `N` 丢弃全部变更
- `Ctrl+P` 全局快捷键打开 DiffPanel
- `/diff` 命令管理系统

### Agent Mode / Model 管理

- `/mode` 查看/切换 agent 会话模式（通过 `setSessionConfigOption`）
- `/mode <value>` 全局设置默认 mode：写入 `.module-agent.json` + 应用到所有运行中的 agent
- `model` 配置项在 session 创建时通过 ACP 协议设置（非 CLI 参数）
- `defaultMode` 配置项控制 agent 启动时的默认模式

### 文本选择与复制

- 所有消息文本支持鼠标选择（`selectable` 属性）
- `useSelectionHandler` 自动将选中文本通过 OSC 52 推入系统剪贴板

### 命令子命令推荐

输入 `/role ` 或 `/diff ` 等命令+空格后，CommandPalette 自动切换为子命令列表（如 `/role list`, `/role start`）。`/mode ` 动态获取当前 agent 支持的模式列表。

### 工作区边界保护

- Agent 启动前在 cwd 执行 `git init` 锚定 workspace 边界
- Prompt 中注入 `Workspace Boundary` 指令
- `sessionUpdate` 层拦截越界工具调用（注入错误消息，不 kill 进程）
- `requestPermission` 层检查路径并返回拒绝原因
