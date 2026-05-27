# Workflow Agents — 工作流 Agent 管理与工作空间

> 文件：`src/agents/WorkflowManager.ts`, `src/agents/WorkflowWorkspace.ts`

---

## WorkflowManager — 工作流 Agent 管理器

**类**：`WorkflowManager`

### 概述

`WorkflowManager` 管理工作流步骤 Agent 的启动、停止和生命周期。每个工作流步骤都可能启动一个独立的 Agent 子进程来执行任务。

### WorkflowStepAgentEntry

```typescript
interface WorkflowStepAgentEntry {
  name: string;
  config: AgentConfig;
  launched: LaunchedAgent;
  sessionId: string;
  workspacePath: string;
}
```

### Agent 命名

工作流中的 Agent 使用复合键标识：`${workflowName}:${stepName}`

```typescript
WorkflowManager.agentKey('build', 'compile')  // → "build:compile"
```

### startStepAgent(workflowName, step, workspacePath, agentConfig?)

```
1. 生成 agentKey = "workflowName:stepName"
2. 检查是否已运行
3. AgentLauncher.launch(config, agentKey, workspacePath, logger)
4. Wire onSessionUpdate → 转发流式更新
5. buildStepMcpServers(workspacePath)
   → 使用 dist/mcp-role-server.cjs（与角色 Agent 相同的工具集）
6. connection.newSession({ cwd: workspacePath, mcpServers })
7. 存入 agents Map
```

### stopStepAgent / dispose

- `stopStepAgent(agentKey)`: 清理工作空间 + kill 子进程
- `dispose()`: 停止所有步骤 Agent

---

## WorkflowWorkspace — 工作流步骤工作空间

`src/agents/WorkflowWorkspace.ts`

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
  │   └─ fse.copy(srcDir, destDir, { filter: 排除 node_modules, .git })
  │
  └─ 返回 stepDir 路径
```

### collectStepOutput(options)

步骤执行完成后，将工作空间中生成的文件复制到持久化输出目录：

```
collectStepOutput({
  workspacePath, outputPath, workflowName, stepName
})
  │
  ├─ 遍历 workspacePath 中的所有文件
  ├─ 计算相对路径
  ├─ 复制到 outputPath/<stepName>/
  └─ 返回复制文件列表
```

### cleanupStepWorkspace(workspacePath)

删除步骤工作空间目录。

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
.module-agent/workflow/
└── <workflowName>/
    └── output/
        ├── step1/
        │   └── (步骤 1 产生的文件)
        └── step2/
            └── (步骤 2 产生的文件)
```

---

## 与角色的相似性

工作流步骤 Agent 与角色 Agent 共享以下特性：
- 使用相同的 MCP Server bundle（`dist/mcp-role-server.cjs`）
- 工作空间隔离策略相同（复制可见模块源码）
- 不提供模块间通信工具

区别在于工作流步骤是短暂的、有序的，而角色 Agent 是持久的、可反复交互的。
