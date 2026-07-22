# RoleAgentSubsystem — 角色 Agent 子系统

> 文件：`src/core/RoleAgentSubsystem.ts` | 类：`RoleAgentSubsystem`

## 概述

`RoleAgentSubsystem` 管理角色 Agent 的完整生命周期。角色 Agent 是拥有特定职责和对特定模块路径可见性的专用 Agent，与模块 Agent 不同——它们不参与模块间调用（不注入 CrossModuleRouter），而是在 `projectPath` 下由 `AgentSandbox` 按 `visibleModulePaths` 限制文件可见范围工作。角色 Agent 与模块 Agent 同样运行在**进程内 agent 内核**中（无子进程、无 ACP 连接）。

## 角色 Agent vs 模块 Agent

| 特性 | 模块 Agent | 角色 Agent |
|------|-----------|-----------|
| 工作目录 | 模块对应目录 | `projectPath`（sandbox 按 `visibleModulePaths` 限制） |
| 工具 | 内置工具 + `module_call` / `module_query` / `module_list` + `module_context_*` | 仅内置文件/搜索/git 工具 |
| 系统提示 | `mainagentprompt.md` / `subagentprompt.md` | `roleagentprompt.md` |
| 生命周期管理 | `ModuleAgentSubsystem` | `RoleAgentSubsystem` → `RoleAgentManager` |
| 上下文 key | `<moduleName>` | `workrole:<roleName>` |

## 核心类型

```typescript
// 角色配置（来自 .module-agent.json 的 roles 数组）
interface RoleConfig {
  name: string;                    // 角色名称
  description: string;             // 角色描述
  visibleModulePaths: string[];    // 可见模块路径列表（sandbox 白名单）
  agents: { default: RoleAgentConfig };  // 角色级 LLM 配置
  knowledgeRefs?: { filename: string; name: string }[];  // 知识文件引用
}

// 角色级 LLM 配置 —— 以下字段端到端生效（schema + RoleConfigData 已扩展）
interface RoleAgentConfig {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fastModel?: string;
  contextWindow?: number;
  command?: string;   // ACP 时代残留，可选保留，内核模式忽略
  args?: string[];    // 同上
}
```

## 生命周期

### startRole(role: RoleConfig)

```
1. 委托 RoleAgentManager.startRoleAgent(role)
   a. agents Map / pendingStarts 去重（并发启动复用同一 Promise）
   b. resolveRoleConfig(role) → 透传角色级 provider/apiKey/baseUrl/model/fastModel/contextWindow
   c. 由 visibleModulePaths 构建 AgentSandbox（realpath 包含校验）
   d. Agent.start({ name: `workrole:${name}`, cwd: projectPath, systemPrompt: roleagentprompt,
                    truncation, compaction, archiveDir, ... })
      → 角色 agent 同样享有 snip/compact/truncate 上下文保护管线
   e. 存入 agents Map
```

### sendMessage(roleName, text)

```
1. SendGuard.acquire(roleName) —— 按角色串行化（真 promise 链互斥）
2. 检查角色 Agent 是否已启动（未启动报错，需先 startRole）
3. SessionStore.startStream(`workrole:${roleName}`) → 开始流累积
4. buildPromptBlocks(roleName, text)
   → 系统提示词已在 Agent.start 时以独立 system 角色注入，此处不重复
   → 仅首条消息注入 knowledgeRefs 知识块（sessionPrompted Set 跟踪）
5. entry.agent.send(blocks) → 经 Agent 忙时队列串行执行
6. finishStream → onStreamComplete → persistContext 持久化
7. onPostSend 钩子（summarizer 等后处理）
```

### cancel(roleName)

调用 `agent.cancel()`：abort 当前在途推理，并以 `Canceled` reject 全部排队项（agent 之后可复用）。

### clearRoleContext(roleName)

清空角色上下文，三层一并处理：

1. 运行中 agent 的**内存历史**：`agent.clearContext()`（失败时回退为停止 agent，下次使用时自动重启）
2. **首条消息标记**：`sessionPrompted.delete(roleName)` → 下一条消息重新注入 knowledgeRefs
3. **持久化文件**：`SessionStore.clearContext('workrole:<roleName>')`

### stopRole / dispose

- `stopRole(roleName)`: `agent.stop()`，从 Map 删除
- `dispose()`: 停止所有角色 Agent，清空 sessionPrompted 与 SendGuard

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，通过 `initRoles()` 创建 |
| `RoleAgentManager` | 委托对象，管理角色 Agent 的实际启动/停止 |
| `KernelFactory` / `Agent` | 创建进程内内核并管理其生命周期 |
| `AgentSandbox` | 按 `visibleModulePaths` 限制文件可见范围（realpath 校验） |
| `SessionStore` | 流累积 + 上下文持久化（key 为 `workrole:<roleName>`） |
| `SendGuard` | 按角色的发送互斥锁 |

## 安全模型

- 角色 Agent 的工具仅限内置文件/搜索/git 工具，**没有** `module_call`、`module_query` 等跨模块通信工具
- `AgentSandbox` 强制 realpath 包含校验，所有文件操作限制在 `visibleModulePaths` 白名单内（符号链接/junction 逃逸已堵）
- `visibleModulePaths` 为空时回退为整个 `projectPath` 可见
