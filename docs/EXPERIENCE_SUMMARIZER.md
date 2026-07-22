# ExperienceSummarizer — 对话经验总结

> 文件：`src/core/ExperienceSummarizer.ts` | 类：`ExperienceSummarizer`

## 概述

`ExperienceSummarizer` 负责对模块 Agent 的对话历史进行自动总结：由一个临时的总结 Agent 评估对话内容，按需更新模块的 `module.md`、将经验追加到 `experience.md`、将联动修改规律记录到 `patterns.md`，以便后续对话中作为上下文注入。

## 触发条件

- 通过 `PostSendHooks.createPostSendHook()` 注入 Core 的 `onPostSend` 钩子，在每次对话发送完成后触发（fire-and-forget，后台执行）
- 由 `summarization.enabled` 配置项控制开关（Electron 侧在 `project:scan` 时从工作区配置读入，默认关闭）
- 触发时透传当前 agent 的完整配置（provider/apiKey/baseUrl/model 等）与 `agentCwd`

## 工作流程

```
ExperienceSummarizer.summarize(params)
  │
  ├─ loadPrompt(configDir)
  │   → 从 config/knowledge/summarizerprompt.md 加载总结系统提示（仅加载一次）
  │
  ├─ 启动临时 summarizer agent（进程内内核，无子进程）
  │   → new KernelFactory() + Agent.start({
  │        name: `summarizer-${moduleName}`,
  │        config: agentConfig,
  │        cwd: agentCwd || <projectRoot>/.module-agent/module,
  │        systemPrompt: summarizerPrompt,   // 独立 system 角色注入，锚定前缀缓存
  │      })
  │
  ├─ buildPrompt(moduleName, chatMsgs, projectRoot)
  │   → 任务 Prompt（user 消息，不再重复拼入系统提示）：
  │      Step 1 — 评估：无更新必要时直接回复「无需更新」并停止
  │      Step 2 — 更新 module.md（如代码有变更，只改变化部分）
  │      Step 3 — 追加经验到 experience.md（如有）
  │      Step 4 — 记录联动修改规律到 patterns.md（如有，同名替换）
  │   → 附格式化后的对话内容（单条内容 3000 字符、思考 1000 字符截断）
  │
  ├─ agent.send(blocks) → 等待总结完成
  │
  └─ finally: agent.stop() → 内核模式无子进程，停止 agent 即完成清理
     （失败仅记日志，不向调用方抛出）
```

## 参数

```typescript
interface SummarizeParams {
  moduleName: string;
  chatMsgs: ChatMsg[];          // 要总结的对话消息
  projectRoot: string;
  configDir: string;            // 配置目录（加载 summarizerprompt.md）
  agentConfig: AgentConfig;     // 总结 agent 的 LLM 配置
  agentCwd?: string;            // 总结 agent 工作目录（默认 .module-agent/module）
  logger?: Logger;
}
```

## 与 PromptBuilder 的协作

总结产物回流到后续对话的方式取决于 `progressiveDisclosure`：

- **关闭时**：`PromptBuilder.buildPromptBlocks()` 在构建首次消息时直接注入 `patterns.md` 与 `experience.md`（最近 3 条）内容块
- **开启时（默认）**：首条消息只注入摘要与指引，模型按需通过 `module_context_read_patterns` / `module_context_read_experience` / `module_context_read_full` 工具获取

这样形成了一个闭环：
1. Agent 对话 → 累积消息
2. ExperienceSummarizer → 更新 module.md / 追加 experience.md / 记录 patterns.md
3. PromptBuilder / module_context 工具 → 下次对话注入经验与规范
4. Agent 获得历史经验 → 更精准的上下文理解
