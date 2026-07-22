# RoleAgent — 角色 Agent 管理与可见性沙箱

> 文件：`src/agents/lifecycle/RoleAgentManager.ts`

---

## RoleAgentManager — 角色 Agent 管理器

**类**：`RoleAgentManager`

### 概述

`RoleAgentManager` 负责角色 Agent 的实际启动、停止和生命周期管理。它由 `RoleAgentSubsystem` 委托调用，通过 `KernelFactory` + 统一的 `Agent` 类启动**进程内 agent 内核**（无子进程、无 ACP 连接）。

> 历史说明：早期版本通过 `AgentLauncher` 启动子进程并复制隔离工作空间（`RoleWorkspace.ts`，已删除）。当前实现中角色 Agent 直接在 `projectPath` 下运行，由 `AgentSandbox` 按 `visibleModulePaths` 限制文件可见范围。

### RoleAgentEntry

```typescript
interface RoleAgentEntry {
  agent: Agent;              // 统一 Agent 生命周期对象（含内核）
  workspacePath: string;     // 即 projectPath（不再复制工作空间）
  roleConfig: RoleConfig;
}
```

### startRoleAgent(role: RoleConfig)

```
1. 检查 agents Map，已运行则直接返回
2. 检查 pendingStarts Map：同角色并发启动复用同一个 Promise，防止泄漏 agent
3. withRetry（最多 2 次，重试前复查 agents Map）→ _startRoleAgentInternal(role):
   a. resolveRoleConfig(role) → 透传角色级 LLM 配置
      （provider / apiKey / baseUrl / model / fastModel / contextWindow；
       command/args 为 ACP 时代残留字段，内核模式忽略）
   b. 由 visibleModulePaths 计算 allowed 绝对路径列表
      （为空时回退为 [projectPath]），创建 AgentSandbox
   c. Agent.start({
        name: `workrole:${roleName}`,
        config: agentConfig,
        cwd: projectPath,
        launcher: KernelFactory,
        sandbox,                       // 文件工具限制在 allowed 内（realpath 校验）
        systemPrompt: roleagentprompt.md 内容,  // 独立 system 角色注入，锚定前缀缓存
        truncation, compaction,        // 上下文截断/在线压缩保护（透传自主配置）
        archiveDir,                    // 丢弃内容存档目录
        onNotification / onQueue / onSystemMessage,
      })
   d. 存入 agents Map
```

### 角色 Agent 的工具集

内核模式下没有独立的角色 MCP 服务器（`dist/mcp-role-server.cjs` 与 `workrole_read_file` / `workrole_write_file` 工具已随 ACP 层一并移除）。角色 Agent 使用内核内置工具：

- `file_read` / `file_write` / `file_edit` / `search` / `list_files` / `git_operations`
- 全部经 `AgentSandbox` 限制在 `visibleModulePaths` 范围内（realpath 包含校验，符号链接/junction 逃逸已堵）
- **不注册** `module_call` / `module_query` / `module_list`（未注入 CrossModuleRouter）

### stopRoleAgent / stopAll

- `stopRoleAgent(roleName)`: `agent.stop()` 并从 Map 删除（无工作空间可清理）
- `stopAll()`: 停止所有角色 Agent，清空 agents / pendingStarts

---

## 可见性模型

```
RoleConfig.visibleModulePaths: ["src/core", "src/agents"]
  │
  ├─ path.resolve(projectPath, p) → allowed 绝对路径列表
  ├─ new AgentSandbox({ allowed, excluded: [] })
  └─ 内核文件工具每次访问前做 realpath 包含校验
```

`visibleModulePaths` 为空时，角色对整个 `projectPath` 可见。

---

## 与模块 Agent 的关键区别

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| 工作目录 | 模块对应目录 | `projectPath`（sandbox 限制可见路径） |
| 工具 | 内置工具 + `module_call` / `module_query` / `module_list` + `module_context_*` | 仅内置文件/搜索/git 工具 |
| 系统提示 | `mainagentprompt.md` / `subagentprompt.md` | `roleagentprompt.md` |
| 跨模块通信 | 支持 `module_call` / `module_query` | 不支持 |
| 上下文 key | `<moduleName>` | `workrole:<roleName>` |
