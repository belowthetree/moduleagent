# Workflow Agents — 工作流 Agent 管理与工作空间

> 文件：`src/agents/lifecycle/WorkflowManager.ts`, `src/agents/lifecycle/WorkflowWorkspace.ts`

---

## WorkflowManager — 工作流 Agent 管理器

**类**：`WorkflowManager`

### 概述

`WorkflowManager` 管理工作流步骤 Agent 的启动、停止和生命周期。每个工作流步骤通过 `KernelFactory` + 统一的 `Agent` 类启动一个**进程内 agent 内核**执行任务（无子进程、无 ACP 连接）。

### WorkflowStepAgentEntry

```typescript
interface WorkflowStepAgentEntry {
  agent: Agent;
  workspacePath: string;
}
```

### Agent 命名

工作流中的 Agent 使用复合键标识：`${workflowName}:${stepName}`

```typescript
WorkflowManager.agentKey('build', 'compile')  // → "build:compile"
```

### startStepAgent(workflowName, stepName, agentConfig, workspacePath, systemPrompt?)

```
1. 生成 agentKey = "workflowName:stepName"
2. 检查是否已运行（agents Map）
3. pendingStarts 去重：同 key 并发启动复用同一个 Promise，防止泄漏 agent
4. withRetry（最多 2 次，重试前复查 agents Map）→ _startStepAgentInternal:
   a. Agent.start({
        name: `workflow:${key}`,
        config: agentConfig,        // 项目级默认配置（step 级 command/args 已无效）
        cwd: workspacePath,         // 隔离工作空间
        launcher: KernelFactory,
        systemPrompt,               // subagentprompt.md，独立 system 角色注入
        truncation, compaction,     // 上下文截断/在线压缩保护（透传自主配置）
        archiveDir,                 // 丢弃内容存档目录
        onNotification / onQueue / onSystemMessage,
      })
   b. 存入 agents Map
```

步骤 Agent 使用内核内置工具（`file_read` / `file_write` / `file_edit` / `search` / `list_files` / `git_operations`），sandbox 限定在步骤工作空间内；不注册跨模块通信工具。

### stopStepAgent / stopAll

- `stopStepAgent(workflowName, stepName)`: `agent.stop()` 并从 Map 删除（工作空间清理由 `WorkflowSubsystem` 调 `cleanupStepWorkspace` 负责）
- `stopAll()`: 停止所有步骤 Agent，清空 agents / pendingStarts

---

## WorkflowWorkspace — 工作流步骤工作空间

`src/agents/lifecycle/WorkflowWorkspace.ts`

### prepareStepWorkspace(options)

为工作流步骤准备隔离工作空间：

```
prepareStepWorkspace({
  workflowName, stepName, visibleModulePaths, projectPath, workspaceRoot
})
  │
  ├─ 创建 workflow/<workflowName>/<stepName>/ 目录
  │
  ├─ 遍历 visibleModulePaths:
  │   ├─ srcDir = projectPath + modulePath
  │   ├─ destDir = stepDir + modulePath
  │   ├─ 跳过不存在的路径 / srcDir === destDir
  │   └─ fse.copy(srcDir, destDir, { filter: 排除 node_modules, .git })
  │
  └─ 返回 stepDir 路径
```

### collectStepOutput(options)

步骤执行完成后，将工作空间中生成的文件复制到持久化输出目录：

```
collectStepOutput({
  workspacePath, outputPath, workflowName, stepName, workspaceRoot
})
  │
  ├─ 遍历 workspacePath 顶层条目（跳过 node_modules / .git）
  ├─ 复制到 workspaceRoot/workflow-output/<workflowName>/<outputPath>/
  └─ 返回输出目录路径
```

### cleanupStepWorkspace(options)

```
cleanupStepWorkspace({ workflowName, stepName, workspaceRoot })
  → 删除 workspaceRoot/workflow/<workflowName>/<stepName>/ 目录
```

---

## 工作空间结构

```
.module-agent/workspace/workflow/
└── <workflowName>/
    └── <stepName>/
        ├── src/              # 复制的可见模块源码
        │   ├── core/
        │   └── agents/
        └── (step 输出文件)
```

输出目录：

```
.module-agent/workspace/workflow-output/
└── <workflowName>/
    └── <outputPath>/         # 通常为 <stepName>；有验收标准时为 step-<stepName>
        └── (步骤产生的文件)
```

---

## 与角色的相似性

工作流步骤 Agent 与角色 Agent 共享以下特性：
- 都运行在进程内 agent 内核中，使用同一套内置文件/搜索/git 工具
- 都不提供模块间通信工具
- 都有 truncation/compaction 上下文保护

区别在于：
- 工作流步骤 Agent 在**复制的隔离工作空间**中运行（步骤间互不污染），是短暂的、有序的；
- 角色 Agent 直接在 `projectPath` 下运行（sandbox 限制可见路径），是持久的、可反复交互的。
