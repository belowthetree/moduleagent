# RoleAgent — 角色 Agent 管理与工作空间

> 文件：`src/agents/RoleAgentManager.ts`, `src/agents/RoleWorkspace.ts`

---

## RoleAgentManager — 角色 Agent 管理器

**类**：`RoleAgentManager`

### 概述

`RoleAgentManager` 负责角色 Agent 的实际启动、停止和生命周期管理。它由 `RoleAgentSubsystem` 委托调用，统一使用 `AgentLauncher` 启动子进程。

### RoleAgentEntry

```typescript
interface RoleAgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  workspacePath: string;
  roleConfig: RoleConfig;
}
```

### startRoleAgent(role: RoleConfig)

```
1. 检查 agents Map，已运行则直接返回
2. 检查 pendingStarts Map，防止重复启动
3. _startRoleAgentInternal(role):
   a. prepareRoleWorkspace({ roleName, visibleModulePaths, projectPath, workspaceRoot })
      → 创建隔离工作空间
   b. resolveAgentConfig(role) → 获取 Agent 命令行配置
   c. AgentLauncher.launch(config, `role-${roleName}`, workspacePath, logger)
      → 启动 Agent 子进程
   d. Wire onSessionUpdate → 转发流式更新
   e. _buildRoleMcpServers(workspacePath)
      → 使用 dist/mcp-role-server.cjs
      → 工具: workrole_read_file, workrole_write_file
   f. connection.newSession({ cwd: workspacePath, mcpServers })
   g. 存入 agents Map
```

### 角色 MCP 服务器配置

```typescript
_buildRoleMcpServers(workspacePath): McpServerStdio[] {
  return [{
    name: 'role-agent',
    command: 'node',
    args: ['dist/mcp-role-server.cjs', '--workspace', workspacePath],
    env: [],
  }];
}
```

### stopRoleAgent / dispose

- `stopRoleAgent(roleName)`: 清理工作空间 + kill 子进程
- `dispose()`: 停止所有角色 Agent

---

## RoleWorkspace — 角色工作空间准备

`src/agents/RoleWorkspace.ts`

### prepareRoleWorkspace(options)

为角色 Agent 准备隔离工作空间，复制所有可见模块的源码：

```
prepareRoleWorkspace({
  roleName, visibleModulePaths, projectPath, workspaceRoot
})
  │
  ├─ 创建 workrole/<roleName>/ 目录
  │
  ├─ 遍历 visibleModulePaths:
  │   ├─ srcDir = projectPath + modulePath
  │   ├─ destDir = roleDir + modulePath
  │   ├─ 跳过不存在的路径
  │   ├─ 跳过 srcDir === destDir
  │   └─ fse.copy(srcDir, destDir, { filter: 排除 node_modules, .git })
  │
  └─ 返回 roleDir 路径
```

### cleanupRoleWorkspace(roleName, workspaceRoot)

删除角色工作空间目录。

---

## 工作空间结构

```
.module-agent/workspace/workrole/
└── <roleName>/
    ├── src/
    │   ├── core/          # 从可见模块复制的源码
    │   └── agents/
    └── ...
```

---

## 与模块 Agent 的关键区别

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| MCP Server | `dist/mcp-server.cjs`（5 个模块工具） | `dist/mcp-role-server.cjs`（2 个文件工具） |
| 系统提示 | `mainagentprompt.md` / `subagentprompt.md` | `roleagentprompt.md` |
| 工作空间 | 单模块源码（排除子模块） | 多模块源码（按 visibleModulePaths） |
| 跨模块通信 | 支持 `module_call` / `module_query` | 不支持 |
