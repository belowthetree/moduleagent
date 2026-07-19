# TuiBridge — TUI 桥接层

> 文件：`src/tui/bridge.ts` | 类：`TuiBridge` | 最后更新: 2026-07-18

## 概述

`TuiBridge` 是 TUI（终端用户界面）模式下连接 Core 层和 SolidJS UI 的桥接适配器。它同时管理 **模块 Agent**、**角色 Agent** 和 **工作流** 三个子系统的生命周期，并通过 `CoreCallbacks` 将流式响应翻译为 SolidJS 信号更新。

## 架构位置

```
┌──────────────────────────────────────────────────┐
│  TUI Renderer (SolidJS)                          │
│  ┌────────────────────────────────────────────┐  │
│  │ tuiState.messages()   — 消息列表            │  │
│  │ tuiState.agentStatus() — 当前状态           │  │
│  │ tuiState.currentTarget() — module/role/wf   │  │
│  │ tuiState.currentAgent()  — 当前 agent 名    │  │
│  │ tuiState.screen()     — setup/chat/tree/roles│ │
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
│  │ TuiSessionStore           ← 展示缓存       │  │
│  │ InputHistoryPersistence   ← 输入历史       │  │
│  │ ExperienceSummarizer      ← 经验总结       │  │
│  └────────────────────────────────────────────┘  │
│  Core SessionStore (共享)                        │
│    ├── context/<module>.json       ← 模块上下文  │
│    └── context/workrole:<name>.json ← 角色上下文 │
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
  ├── InputHistoryPersistence.load()        → 恢复输入历史
  ├── TuiSessionStore.loadHistory(core, rootAgent) → 从 Core SessionStore 加载历史
  └── syncTo(tuiState)                      → 同步到 SolidJS 信号
```

### 三目标系统（module / role / workflow）

`tuiState.currentTarget()` 决定消息路由目标。角色和工作流各自维护独立的会话上下文：

| target | 路由方法 | 消息发送 | 上下文键 |
|--------|---------|---------|---------|
| `module` | `core.sendMessage(text)` | → ModuleAgentSubsystem | `context/<module>.json` |
| `role` | `core.roles.sendMessage(name, text)` | → RoleAgentSubsystem | `context/workrole:<name>.json` |
| `workflow` | `core.workflows.executeWorkflow(name, text)` | → WorkflowSubsystem | — |

**目标感知过滤**：`TuiBridge._isCurrent(name)` 根据 `currentTarget` 选择比较基准——module 目标对比 `core.getCurrentAgent()`（模块子系统），role/workflow 目标对比 `tuiState.currentAgent()`。所有流式回调（onStreamChunk/onStreamComplete/onStreamError/onMessage/onToolCall）统一经此过滤，避免跨目标消息污染当前视图。

**目标复位**：`TuiBridge.setCurrentAgent()`（切换模块）会同时执行 `tuiState.setCurrentTarget('module')`，确保从角色/工作流切回模块后路由正确。

## 核心设计

### 流式消息类型系统

`onStreamChunk` 回调接收 `type: 'message' | 'thought'`，TuiBridge 分别追加到独立的流式消息：

```typescript
// CoreCallbacks
onStreamChunk: (moduleName, text, type) => {
  if (!self._isCurrent(moduleName)) return;
  const msgType: MessageType = type === 'message' ? 'agent_reply' : 'agent_thought';
  const msgId = type === 'message' ? self.store.replyId : self.store.thoughtId;
  self.store.appendChunk(msgId, text, msgType);
}
```

消息类型枚举 (`MessageType`):

| msgType | 说明 |
|---------|------|
| `user` | 用户输入 |
| `agent_reply` | Agent 回复 |
| `agent_thought` | Agent 思考过程（可折叠） |
| `tool_call` | 工具调用 |
| `system` | 系统通知 |
| `cross_context` | 跨模块通信 |

### 消息生命周期

```
用户输入
  → 创建 user 消息（TuiSessionStore.addUserMsg）
  → startStream() 生成 replyId / thoughtId
  → 发送到目标子系统
  → onStreamChunk:
      'message' → appendChunk(replyId, text, 'agent_reply')
      'thought' → appendChunk(thoughtId, text, 'agent_thought')
      tool_call  → 创建/更新 tool_call 消息
  → onStreamComplete:
       finalizeStream() 加时间戳 → syncTo(tuiState)
  → autoSave() (仅 module 目标，角色/工作流由各自子系统自行持久化)
```

### 对话持久化

消息持久化已统一到 Core 层 `SessionStore`（`.module-agent/context/` 目录）：
- **模块上下文**：`ModuleAgentSubsystem` 在 sendMessage 后调用 `SessionStore.saveContext(moduleName, msgs)`
- **角色上下文**：`RoleAgentSubsystem` 在 sendMessage 后调用 `persistContext(stateManager, 'workrole:<name>', ...)`
- **TUI 展示层**：`TuiSessionStore` 仅做展示缓存 + `ChatMsg` ↔ `ChatMessage` 格式互转；`loadHistory` 从 Core `SessionStore.loadContext` 加载
- **autoSave**：仅在 `currentTarget === 'module'` 时调用 `core.modules.saveContext`

### 输入历史

- **存储**: `InputHistoryPersistence` → `.module-agent/tui_input_history.json`
- **容量**: 最多 100 条（自动截断）
- **导航**: ↑ 键回退，↓ 键前进
- **持久化**: 每次提交后后台异步保存

## 屏幕系统

TUI 通过 `tuiState.screen()` 驱动四种全屏界面，外加浮层：

| screen | 组件 | 触发方式 |
|--------|------|---------|
| `setup` | SetupWizard | 首次启动、`/setup`、`/config` |
| `chat` | ContextArea + InputBox + StatusBar + CommandPalette | 默认 |
| `tree` | ModuleTree（兼 ExperiencePanel） | `Ctrl+X T`、`/tree`、QuickPanel |
| `roles` | RolePanel | `Ctrl+X R`、QuickPanel |
| 浮层 | QuickPanel | `Ctrl+P`（绝对定位覆盖） |
| 浮层 | ExperiencePanel | 树模式选择模块后 |

全屏组件遵循统一模式：顶部标题栏 + 隐藏 `<input>`（键盘事件路由必需）+ scrollbox 列表。Esc 处理在 `App.tsx` 的 `useKeyboard` 或组件自身。

## 组件架构

```
App.tsx
├── screen === 'setup'  → SetupWizard
├── screen === 'roles'  → RolePanel
├── screen === 'tree'   → ModuleTree / ExperiencePanel
└── screen === 'chat'
    ├── ContextArea     — 消息列表（按 msgType 分类渲染）
    ├── CommandPalette  — / 命令候选面板（动态过滤）
    ├── InputBox        — 输入框 + 历史导航
    └── StatusBar       — 状态栏（类型：agent | M:N R:N W:N | cwd）
    └── QuickPanel      — 浮层（Ctrl+P 快捷面板)
```

## 命令系统

### 模块命令
- `/list` — 列出所有模块
- `/tree` — 交互式模块树面板（↑↓←→ 导航，Enter 切换，Esc 关闭）
- `/rescan` — 重新扫描模块
- `/get <name>` — 查看模块详情
- `/module <name>` — 切换到指定模块
- `/mode <value>` — 切换/设置 agent 模式
- `/model <value>` — 切换/设置 agent 模型
- `/new` — 创建新会话

### 角色命令
- `/role list` — 列出所有角色
- `/role start <name>` — 启动角色 Agent
- `/role stop <name>` — 停止角色 Agent
- `/role cancel` — 取消当前角色操作

### 工作流命令
- `/workflow list` — 列出所有工作流
- `/workflow run <name>` — 执行工作流
- `/workflow status` — 查看执行状态
- `/workflow cancel` — 取消执行

### 其他命令
- `/thought` — 切换思考内容可见性
- `/status` — 显示 M/R/W 子系统状态
- `/save [name]` — 保存当前对话
- `/load [name]` — 加载历史对话
- `/clear` — 清空上下文（当前模块）
- `/clearall` — 清空所有上下文
- `/setup` — 重新配置项目
- `/help` — 显示帮助
- `/quit` — 退出 TUI

## 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+P` | 打开快捷面板（模块树/经验/角色选择） |
| `Ctrl+X T` | 切换模块树 |
| `Ctrl+X R` | 切换角色选择 |
| `Ctrl+X H` | 切换经验浏览 |
| `Ctrl+C` | 流式输出中取消当前请求 |
| `Ctrl+D` | 保存并退出 |
| `↑` / `↓` | 输入历史导航 |

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/tui/bridge.ts` | 桥接核心：三子系统管理 + 流式路由 + 目标感知过滤 |
| `src/tui/renderer.tsx` | OpenTUI 渲染器启动 + keymap 快捷键 + globalThis 钩子 |
| `src/tui/state.ts` | SolidJS 响应式状态（~20 个信号） |
| `src/tui/types.ts` | TUI 类型定义（TuiScreen, MessageType, ChatMessage 等） |
| `src/tui/commands.ts` | 命令系统（20 个分支，含角色/工作流） |
| `src/tui/persistence.ts` | 输入历史持久化（仅 InputHistoryPersistence，100 条上限） |
| `src/tui/TuiSessionStore.ts` | 展示层消息缓存 + ChatMsg ↔ ChatMessage 格式互转 |
| `src/tui/config.ts` | 配置读写 helper |
| `src/tui/cjk.ts` | CJK 字符宽度计算工具 |
| `src/tui/App.tsx` | 主布局组件 + 屏幕路由 + ESC/键盘处理 |
| `src/tui/components/ContextArea.tsx` | 消息列表（按 msgType 渲染，支持文本选择） |
| `src/tui/components/InputBox.tsx` | 输入框 + 历史导航 + 粘贴处理 |
| `src/tui/components/StatusBar.tsx` | 状态栏（类型：agent | M:N R:N W:N | cwd） |
| `src/tui/components/CommandPalette.tsx` | / 命令候选面板 + 子命令推荐 |
| `src/tui/components/SetupWizard.tsx` | 设置向导（命令→模型→参数→项目目录→确认） |
| `src/tui/components/ModuleTree.tsx` | 交互式模块树面板 + 经验浏览模式 |
| `src/tui/components/ExperiencePanel.tsx` | 模块经验查看（Markdown 渲染） |
| `src/tui/components/QuickPanel.tsx` | Ctrl+P 快捷面板（模块树/经验/角色选择入口） |
| `src/tui/components/RolePanel.tsx` | 角色选择全屏界面（↑↓/jk 导航，Enter 切换） |
| `src/tui/services/index.ts` | 服务层占位导出（已迁移至 Core/TuiBridge） |

## 新增功能

### Agent Mode / Model 管理

- `/mode` 查看/切换 agent 会话模式
- `/mode <value>` 全局设置默认 mode：写入 `.module-agent.json` + 应用到所有运行中的 agent
- `/model` 查看/切换 agent 模型
- `/model <value>` 全局设置默认 model

### 角色选择界面

- `Ctrl+X R` 或快捷面板进入全屏角色列表
- 显示角色名、描述、running 状态、当前角色高亮
- Enter 切换当前 agent 到所选角色（自动加载 `workrole:<name>` 历史）
- Esc 或重复选择当前角色返回 chat

### 文本选择与复制

- 所有消息文本支持鼠标选择（`selectable` 属性）
- `useSelectionHandler` 自动将选中文本通过 OSC 52 推入系统剪贴板

### 命令子命令推荐

输入 `/role ` 或 `/workflow ` 等命令+空格后，CommandPalette 自动切换为子命令列表。`/mode ` 动态获取当前 agent 支持的模式列表。

## 与 ElectronBridge 的差异

| 特性 | ElectronBridge | TuiBridge |
|------|---------------|-----------|
| 通信机制 | Electron IPC (`ipcMain.handle`) | 直接函数调用 |
| 状态管理 | Pinia stores (Vue 3) | SolidJS signals |
| 流式累加 | AgentStateManager | TuiSessionStore（按 msgType 累加） |
| 角色 Agent | 9 个 IPC 通道 | 直接调用 RoleAgentSubsystem |
| 工作流 | 9 个 IPC 通道 | 直接调用 WorkflowSubsystem |
| MCP 后端 | McpBackendServer (HTTP) | McpBackendServer (Core 自动启动) |
| 对话持久化 | AgentStateManager + FileStore | Core SessionStore + TuiSessionStore（展示缓存） |
| 输入历史 | 浏览器原生 | InputHistoryPersistence |
| 跨模块通信通知 | IPC cross-context 推送 | 系统消息 |
