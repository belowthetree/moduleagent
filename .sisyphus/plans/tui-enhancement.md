# TUI Enhancement Plan — 全面功能完善

> 最后更新: 2026-06-03 | 状态: ✅ 已实施

## 目标

将 TUI 从「单模块 Agent 聊天终端」提升为与 GUI 功能平齐的「全功能 Agent 编排终端」，补齐角色 Agent、工作流、消息分类、对话持久化、输入历史等核心能力。

> 最后更新: 2026-05-30 | 状态: ✅ 已完成

## 已完成

### 会话管理
- ✅ Session Resume: Agent 启动时自动尝试 `session/resume` 恢复上次对话上下文
- ✅ Session 持久化: `.module-agent/sessions/{name}.json` 存储 sessionId
- ✅ `/clear` 同时清除对话文件和 session 记录

### 跨模块通信
- ✅ MCP 后端启动: `ModuleAgentCore.initAll()` 自动启动 McpBackendServer
- ✅ TUI 支持 `module_call` / `module_query` 跨模块通信
- ✅ 跨模块消息通知（蓝色 🔗 前缀，含源/目标 + 方向）

### 模块树
- ✅ 交互式模块树面板 (`/tree`)
- ✅ ↑↓←→ 导航（父/子/兄弟节点移动）
- ✅ Enter 切换模块，Esc 关闭
- ✅ 实时显示模块状态（● ▶ ✗ ◌）

### 设置向导
- ✅ 5 步向导: 命令 → 模型 → 参数 → 项目目录 → 确认
- ✅ 模型字段: `--model` 参数自动追加
- ✅ 配置保存到用户指定的项目目录

### 其他
- ✅ `/rescan` 命令重新扫描模块
- ✅ `/mode` 切换模块时自动加载历史 + 立即启动 Agent
- ✅ 工具调用显示（名称 + 路径/参数 + 跨模块方向）
- ✅ 日志目录跟随项目目录切换
- ✅ 退出时保存对话（Ctrl+D / /quit）

**改动**: `src/tui/bridge.ts`, `src/tui/renderer.tsx`

- ✅ `init()` 扩展：自动调用 `core.initRoles()` 和 `core.initWorkflows()`
- ✅ 构造函数注入 `onRoleSessionUpdate` / `onWorkflowSessionUpdate` 回调
- ✅ `onStreamChunk` 正确区分 `type: 'message' | 'thought'` → 分别追加到独立消息
- ✅ `onStreamComplete` 同时标记 reply 和 thought 消息完成
- ✅ 添加多模块状态跟踪：`moduleStatuses` / `roleStatuses` Map
- ✅ `sendMessage` 按 `currentTarget` (module/role/workflow) 路由
- ✅ 角色管理 API：`startRole`, `sendRoleMessage`, `cancelRole`, `stopRole`, `listRunningRoles`
- ✅ 工作流管理 API：`executeWorkflow`, `cancelWorkflow`, `getWorkflowStatus`, `loadWorkflow`

### Phase 2: 消息类型系统 ✅

**改动**: `src/tui/types.ts`, `src/tui/components/ContextArea.tsx`

- ✅ 新增 `MessageType`: `user` | `agent_reply` | `agent_thought` | `tool_call` | `system` | `cross_context`
- ✅ `ChatMessage` 扩展 `msgType` 字段
- ✅ `ContextArea` 按 msgType 渲染不同图标/颜色
- ✅ `/thought` 命令切换思考内容可见性（默认隐藏 agent_thought 消息）
- ✅ `tool_call` 消息以金色 🔧 图标展示

### Phase 3: 命令系统重构 ✅

**改动**: `src/tui/commands.ts`, `src/tui/components/CommandPalette.tsx`

- ✅ `/role list|start|stop|cancel` — 角色 Agent 生命周期管理
- ✅ `/workflow list|run|status|cancel` — 工作流执行管理
- ✅ `/thought` — 切换思考可见性
- ✅ `/status` — 显示 M/R/W 子系统状态
- ✅ `/save [name]`, `/load [name]` — 对话持久化
- ✅ `/help` 更新为分组显示（模块/角色/工作流/其他）
- ✅ `CommandPalette` 新增 5 条命令候选项

### Phase 4: 对话持久化 ✅

**改动**: `src/tui/persistence.ts` (新建), `src/tui/bridge.ts`

- ✅ `TuiPersistence` — JSON 文件存储（`.module-agent/tui_sessions/`）
- ✅ 初始化时自动恢复上次对话（按 rootAgent 名称）
- ✅ 每次对话完成后 autoSave（2 秒 debounce）
- ✅ `/save [name]` 手动保存，`/load [name]` 列出并加载

### Phase 5: 输入历史 ✅

**改动**: `src/tui/persistence.ts`, `src/tui/components/InputBox.tsx`, `src/tui/renderer.tsx`

- ✅ `InputHistoryPersistence` — JSON 文件存储（最多 200 条，自动去重）
- ✅ 初始化时自动恢复输入历史
- ✅ ↑ 键回退到历史输入，↓ 键前进
- ✅ Enter 提交时追加到历史并后台持久化
- ✅ `StatusBar` 增强：显示 M/R/W 活跃计数

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/tui/bridge.ts` | 重写 | +~240 行：三子系统管理 + 流式路由 + 持久化 |
| `src/tui/types.ts` | 修改 | 新增 MessageType 枚举，ChatMessage 扩展 msgType |
| `src/tui/state.ts` | 修改 | 新增 5 个信号：currentTarget, showThought, inputHistory, historyIndex, activeCounts |
| `src/tui/persistence.ts` | 新建 | TuiPersistence + InputHistoryPersistence |
| `src/tui/commands.ts` | 重写 | +~120 行：角色/工作流/持久化命令 |
| `src/tui/renderer.tsx` | 修改 | init 钩子扩展报告角色/工作流，历史钩子 |
| `src/tui/App.tsx` | 修改 | msgType 添加到消息对象 |
| `src/tui/components/ContextArea.tsx` | 重写 | 按 msgType 分类渲染 + 思考过滤 |
| `src/tui/components/InputBox.tsx` | 修改 | +35 行：↑↓ 历史导航 |
| `src/tui/components/StatusBar.tsx` | 修改 | 显示 M/R/W 计数 |
| `src/tui/components/CommandPalette.tsx` | 修改 | 新增命令候选项 |
| `docs/TUI_BRIDGE.md` | 重写 | 完整文档更新 |

## 未改动范围

- Core 层（`ModuleAgentCore`, `ModuleAgentSubsystem`, `RoleAgentSubsystem`, `WorkflowSubsystem`）— 接口已完备
- Electron 路径 — 零触碰
- 构建管线 — TUI 仍用 Bun 直接运行
- `/setup` 设置向导 — 功能保持
- `IAgentBridge` 接口 — 保持现有契约

## 验证

```bash
# TUI 组件无新增 TS 错误（仅预存 solid-js/jsx 错误）
pnpm run typecheck  # 无新增错误
```
