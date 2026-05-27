# RoleAgentSubsystem — 角色 Agent 子系统

> 文件：`src/core/RoleAgentSubsystem.ts` | 类：`RoleAgentSubsystem`

## 概述

`RoleAgentSubsystem` 管理角色 Agent 的完整生命周期。角色 Agent 是拥有特定职责和对特定模块路径可见性的专用 Agent，与模块 Agent 不同——它们不参与模块间调用，不注入模块 MCP 工具，而是使用独立的文件读写 MCP 工具在隔离工作空间中工作。

## 角色 Agent vs 模块 Agent

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| 工作目录 | `.module-agent/workspace/<module-path>/` | `.module-agent/workspace/workrole/<name>/` |
| 工作空间内容 | 仅本模块源码（排除子模块） | 所有 `visibleModulePaths` 中模块的副本 |
| MCP 工具 | `module_list`, `module_call`, `module_query`, `create_module` | `workrole_read_file`, `workrole_write_file` |
| 系统提示 | `mainagentprompt.md` / `subagentprompt.md` | `roleagentprompt.md` |
| 生命周期管理 | `ModuleAgentSubsystem` | `RoleAgentSubsystem` → `RoleAgentManager` |
| 上下文 key | `<moduleName>` | `workrole:<roleName>` |

## 核心类型

```typescript
// 角色配置（来自 .module-agent.json）
interface RoleConfig {
  name: string;                    // 角色名称
  description: string;             // 角色描述
  visibleModulePaths: string[];    // 可见模块路径列表
  agents: { default: RoleAgentConfig };  // Agent 命令配置
  knowledgeRefs?: { filename: string; name: string }[];  // 知识文件引用
}
```

## 生命周期

### startRole(role: RoleConfig)

```
1. 检查角色名是否为空
2. 检查是否已运行（agents Map）
3. 通过 RoleAgentManager.startRoleAgent(role)
   a. prepareRoleWorkspace({ roleName, visibleModulePaths, projectPath, workspaceRoot })
      → 创建 workrole/<name>/ 目录
      → 复制每个可见模块的源码（排除 node_modules、.git）
   b. AgentLauncher.launch() → spawn 子进程，建立 ACP 连接
   c. buildRoleMcpServers(workspacePath)
      → 使用 dist/mcp-role-server.cjs
      → 工具: workrole_read_file, workrole_write_file
   d. connection.newSession({ cwd, mcpServers })
   e. 存入 agents Map
```

### sendMessage(roleName, text)

```
1. 检查角色 Agent 是否已启动（自动启动）
2. sendLock mutex（按角色串行化）
3. buildPromptBlocks → 首次消息注入 roleagentprompt.md + knowledgeRefs
4. connection.prompt() → 发送到 ACP Agent
```

### stopRole / dispose

- `stopRole(roleName)`: kill 子进程，清理工作空间，从 Map 删除
- `dispose()`: 停止所有角色 Agent

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，通过 `initRoles()` 创建 |
| `RoleAgentManager` | 委托对象，管理角色 Agent 的实际启动/停止 |
| `RoleWorkspace` | 准备角色专用隔离工作空间 |
| `RoleMCPServer` | 角色专用 MCP 工具（文件读写，无模块通信） |
| `AgentLauncher` | 启动 Agent 子进程 |
| `PromptBuilder` | 构建角色 Agent 专用 Prompt |

## 安全模型

- 角色 Agent 的 MCP 工具仅限文件读写，**没有** `module_call`、`module_query` 等跨模块通信工具
- `RoleMCPServer` 强制路径检查，所有文件操作限制在 workspace 内
- 可见模块由 `visibleModulePaths` 白名单控制
