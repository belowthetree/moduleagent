# WorkflowSubsystem — 工作流子系统

> 文件：`src/core/WorkflowSubsystem.ts` | 类：`WorkflowSubsystem`

## 概述

`WorkflowSubsystem` 负责多步骤工作流的编排与执行。工作流由多个步骤（STEP）组成，每个步骤由独立的进程内 agent 内核执行，支持步骤间数据传递和验收检查。

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
  visibleModulePaths: ["src/core", "src/agents"]
  knowledgeRefs:
    - filename: "ARCHITECTURE.md"
      name: "架构文档"
---

# 分析代码结构

请扫描项目目录，分析各模块之间的依赖关系...
```

> 注：`agent.command` / `agent.args` 是 ACP 时代的步骤级覆盖字段，内核模式下已失效——`_resolveAgentConfig` 统一使用项目级默认配置（主配置 `agents.default` 的 provider/model/apiKey 等）。`visibleModulePaths` 与 `knowledgeRefs` 仍然有效。

## 核心类型

```typescript
interface WorkflowDescriptor {
  name: string;
  dir: string;
  steps: WorkflowStepDescriptor[];
}

interface WorkflowStepDescriptor {
  name: string;
  dir: string;
  definition: StepDefinition;      // 解析自 STEP.md frontmatter
  body: string;                    // STEP.md 正文
}

interface WorkflowExecutionState {
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  startedAt: string;
  completedAt?: string;
  stepResults: WorkflowStepResult[];
}
```

## 执行流程

### executeWorkflow(workflowName, userInput?)

```
1. WorkflowScanner.loadWorkflow(workflowName)
   → 解析 STEP.md 文件，返回 WorkflowDescriptor

2. 状态置 running，逐步骤调用 executeStep(step, index):
   a. _collectInput(step, previousResults, userInput)
      → from 'user': 使用 executeWorkflow 传入的 userInput
      → from 'previous': 读取上一步骤输出目录内容
      → from 'both': 两者合并

   b. _resolveAgentConfig(step, projectAgentConfig)
      → 内核模式忽略 step 级 command/args，统一项目级默认配置

   c. prepareStepWorkspace({ workflowName, stepName, visibleModulePaths })
      → 创建隔离工作空间，复制可见模块源码

   d. WorkflowManager.startStepAgent(workflowName, stepName, agentConfig,
                                    workspacePath, subPrompt)
      → 启动步骤专用 agent 内核（pendingStarts 去重 + 失败重试一次）
      → subagentprompt.md 以独立 system 角色注入（前缀缓存锚定）
      → 步骤 agent 带 truncation/compaction 上下文保护

   e. _buildStepPrompt(wf, step, inputContext)
      → knowledgeRefs/步骤 knowledge 目录 + 步骤 body + 产出要求 + 输入上下文
      → （系统提示不在此重复拼入）

   f. entry.agent.send(blocks)
      → 等待 Agent 完成推理（经 Agent 忙时队列串行执行）

   g. collectStepOutput()
      → 从工作空间收集输出文件到 workflow-output/<wf>/<outputPath>/

   h. stopStepAgent() → 停止步骤 agent

   i. runAcceptance(step, outputDir)
      → 可选：步骤定义了 acceptance.criteria 时执行验收检查

3. 每步完成后 saveState() → 持久化执行状态到 .state.json
   （任一步骤失败则整体状态 failed 并中止；abortFlag 置位则为 cancelled）
```

## 关键设计

### 输入收集 (_collectInput)

支持三种模式：
- `user`：使用 `executeWorkflow(name, userInput)` 传入的用户输入
- `previous`：读取源步骤 `outputDir` 的文件内容（默认上一步，可用 `sourceStep` 指定；最多 20 个文件、单文件 50KB / 内容 5000 字符上限）
- `both`：合并用户输入和上一步输出

### 验收检查 (runAcceptance)

如果步骤定义了 `acceptance.criteria`，会启动一个独立的验收 Agent（独立工作空间 `<step>-acceptance`，同样注入 subagent 系统提示）：

- 读取步骤输出目录内容，构建验收 Prompt：先简要分析，然后在**回复最后一行**单独输出 `VERDICT: PASS` 或 `VERDICT: FAIL`
- `parseVerdict` 取回复中**最后一个** `VERDICT: PASS|FAIL` 行（大小写不敏感）
- **无法解析时保守判定 FAIL**（记 warn 日志）；验收过程异常同样判 FAIL
- 验收结果写入 `WorkflowStepResult.acceptancePassed`

### 取消 (cancel)

`cancel(workflowName)`：置 `abortFlag`（步骤循环在下一步前检查并退出），并对当前工作流所有运行中的步骤 agent 调 `agent.cancel()`（abort 在途推理、以 `Canceled` reject 排队项），状态落盘为 `cancelled`。

### 状态持久化

每次步骤完成后自动保存 `WorkflowExecutionState` JSON 到 `.state.json`，支持中断后查询执行进度（`getExecutionState`）。

## 与其他模块的关系

| 模块 | 关系 |
|------|------|
| `ModuleAgentCore` | 父级编排器，通过 `initWorkflows()` 创建 |
| `WorkflowScanner` | 扫描和解析工作流目录 |
| `WorkflowManager` | 管理步骤 Agent 的启动/停止（pendingStarts 去重） |
| `WorkflowWorkspace` | 准备步骤隔离工作空间、收集输出、清理 |
| `KernelFactory` / `Agent` | 创建进程内内核并管理其生命周期 |
