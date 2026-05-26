# IPC 命令参考

> 33 个 Tauri IPC 命令，前端通过 `invoke()` 调用。

## 项目

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `project_scan` | `body: { projectPath }` | `{ root, nodes, moduleCount }` | 扫描项目目录，构建模块图谱，存入 state |
| `project_tree` | — | `TreeNode \| null` | 返回模块树结构，无模块时返回 null |
| `project_generate` | — | `{ count: 0 }` | 已废弃（使用角色 Agent 替代） |

## Agent 生命周期

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `agent_start` | `body: { name, command, args, cwd }` | `{ sessionId }` | 启动模块 Agent |
| `agent_send` | `body: { name, text, cwd }` | `{ result: { reply, thinking, tools } }` | 发送消息并等待回复 |
| `agent_cancel` | `body: { name }` | `{ reply, thinking, tools }` | 取消当前操作 |
| `agent_stop` | `body: { name }` | `{ ok: true }` | 停止并移除 Agent |
| `agent_running` | — | `[{ name, status }]` | 列出所有运行中的 Agent |

## 配置

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `config_get` | `body: { projectRoot }` | `{ command, args, projectPath, ... }` | 读取项目配置 |
| `config_save` | `body: { projectRoot, command, args, projectPath }` | `{ ok: true }` | 保存项目配置 |

## 上下文

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `context_get` | `name: String` | `ChatMsg[]` | 读取模块会话上下文 |
| `context_clear` | `name: String` | `{ ok: true }` | 清除模块上下文 |
| `context_clear_all` | — | `{ ok: true }` | 清除全部上下文 |

## 角色

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `roles_list` | — | `RoleConfigData[]` | 列出角色（空时自动注入默认角色） |
| `roles_save` | `body: RoleConfig` | `{ success: true }` | 保存/更新角色 |
| `roles_delete` | `name: String` | `{ success: true }` | 删除角色 |
| `role_start` | `name: String` | `{ sessionId }` | 启动角色 Agent |
| `role_send` | `name: String, body: { text }` | `{ result: { reply } }` | 向角色 Agent 发送消息 |
| `role_cancel` | `name: String` | `{ ok: true }` | 取消角色 Agent 操作 |
| `role_stop` | `name: String` | `{ ok: true }` | 停止角色 Agent |
| `role_context_get` | `name: String` | `ChatMsg[]` | 读取角色上下文 |
| `role_context_clear` | `name: String` | `{ ok: true }` | 清除角色上下文 |

## 知识库

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `knowledge_list` | — | `[{ filename }]` | 列出知识库文件 |
| `knowledge_read` | `filename: String` | `{ filename, content }` | 读取知识库文件 |
| `knowledge_save` | `body: { filename, content }` | `{ ok: true }` | 保存知识库文件 |
| `knowledge_delete` | `filename: String` | `{ ok: true }` | 删除知识库文件 |

## 工作流

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `workflow_list` | — | `WorkflowListItem[]` | 列出工作流 |
| `workflow_load` | `name: String` | `WorkflowDetail` | 加载工作流详情 |
| `workflow_create` | `body: { name }` | `{ ok: true }` | 创建工作流 |
| `workflow_delete` | `name: String` | `{ ok: true }` | 删除工作流 |
| `workflow_execute` | `name: String, body: { input }` | `{ sessionId, result }` | 执行工作流 |
| `workflow_cancel` | `name: String` | `{ ok: true }` | 取消工作流 |
| `workflow_status` | `name: String` | `{ status }` | 查询工作流状态 |

## 迁移（废弃）

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `migrate_check` | `body: { keys }` | `{ needed, streamNeeded }` | 检查迁移需求 |
| `migrate_data` | `body: payload` | `{}` | 执行数据迁移 |

## 其他

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `select_dir` | `title: String` | `String \| null` | 打开原生目录选择对话框 |

## 项目路径解析

所有需要项目路径的命令使用 `resolve_project_root(body, state)`：
1. `body["projectRoot"]`（前端传入）
2. `state.project_root`（由 `project_scan` 设置）
3. `"."`（当前工作目录）

## 流事件

后端通过 `app_handle.emit("stream", event)` 向前端推送实时流事件：

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `chunk-reply` | `{ text }` | Agent 回复片段 |
| `chunk-thinking` | `{ text }` | Agent 思考片段 |
| `chunk-tool_call` | `{ text }` | 工具调用通知 |
| `agent-status` | `{ name, status }` | Agent 状态变更 |
| `role-status` | `{ name, status }` | 角色 Agent 状态变更 |
