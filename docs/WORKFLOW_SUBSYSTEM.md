# WorkflowSubsystem — 工作流子系统

> 文件：`src/core/WorkflowSubsystem.ts` | 类：`WorkflowSubsystem`

## 概述

`WorkflowSubsystem` 负责多步骤工作流的编排与执行。工作流由多个步骤（STEP）组成，每个步骤由独立的 Agent 执行，支持步骤间数据传递和验收检查。

## 工作流目录结构

```
.module-agent/workflow/
└── <workflow-name>/
    ├── step1/
    │   └── STEP.md          # YAML frontmatter + Markdown body
    ├── step2/
    │   └── STEP.md
    └── <workflow-name>.state.json  # 执行状态持久化
```

## STEP.md 格式

```markdown
---
name: 分析代码结构
description: 扫描项目并分析模块依赖
input:
  from: user          # user | previous | both
  sourceStep: step1   # 可选，指定前一步骤
acceptance:
  criteria: 生成完整的模块依赖关系图
agent:
  command: opencode    # 可选的步骤级 Agent 覆盖
  args: ["acp"]
  visibleModulePaths: ["src/core", "src/agents"]
  knowledgeRefs:
    - filename: "ARCHITECTURE.md"
      name: "架构文档"
---

# 分析代码结构

请扫描项目目录，分析各模块之间的依赖关系...
```

## 核心类型

```typescript
interface WorkflowDescriptor {
  name: string;
  steps: WorkflowStepDescriptor[];
}

interface WorkflowStepDescriptor {
  name: string;
  description?: string;
  stepDir: string;
  stepFilePath: string;
  definition: StepDefinition;      // 解析自 STEP.md frontmatter
}

interface WorkflowExecutionState {
  workflowName: string;
  currentStepIndex: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  stepResults: WorkflowStepResult[];
}
```

## 执行流程

### executeWorkflow(workflowName)

```
1. WorkflowScanner.scanWorkflow(workflowName)
   → 解析 STEP.md 文件，返回 WorkflowDescriptor

2. 对每个步骤循环执行 _executeStep(step, index):
   a. _collectInput(step)
      → from 'user': 等待用户通过 sendMessage 提供输入
      → from 'previous': 使用上一步骤输出
      → from 'both': 两者合并

   b. prepareStepWorkspace({ workflowName, stepName, visibleModulePaths })
      → 创建隔离工作空间，复制可见模块源码

   c. WorkflowManager.startStepAgent(workflowName, step, workspacePath)
      → 启动步骤专用 Agent 子进程
      → 注入 MCP 服务器

   d. buildStepPrompt()
      → 系统提示 + 步骤 body + 输入上下文 + knowledgeRefs

   e. connection.prompt()
      → 等待 Agent 完成推理

   f. collectStepOutput()
      → 从工作空间收集输出文件

   g. runAcceptance(step, output)
      → 可选：启动验收 Agent 检查输出是否满足 acceptance.criteria

3. saveState() → 持久化执行状态到 .state.json
```

## 关键设计

### 输入收集 (_collectInput)

支持三种模式：
- `user`：等待用户通过 `sendWorkflowInput()` 提供
- `previous`：自动使用上一步骤的 `result` 字段
- `both`：合并用户输入和上一步输出

### 验收检查 (runAcceptance)

如果步骤定义了 `acceptance.criteria`，会启动一个独立的验收 Agent：
- 使用轻量 Prompt:"验证以下输出是否满足验收标准..."
- 返回 `boolean` 判定

### 状态持久化

每次步骤完成后自动保存 `WorkflowExecutionState` JSON 到 `.state.json`，支持中断恢复。

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，通过 `initWorkflows()` 创建 |
| `WorkflowScanner` | 扫描和解析工作流目录 |
| `WorkflowManager` | 管理步骤 Agent 的启动/停止 |
| `WorkflowWorkspace` | 准备步骤隔离工作空间 |
| `AgentLauncher` | 启动步骤 Agent 子进程 |
