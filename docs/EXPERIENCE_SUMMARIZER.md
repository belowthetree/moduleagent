# ExperienceSummarizer — 对话经验总结

> 文件：`src/core/ExperienceSummarizer.ts` | 类：`ExperienceSummarizer`

## 概述

`ExperienceSummarizer` 负责对模块 Agent 的对话历史进行自动总结，将长期对话压缩为简短的经验记录，写入模块的 `experience.md` 文件，以便后续对话中作为上下文注入。

## 触发条件

- 由调用方（如 `ElectronBridge`）在每次对话完成后判断是否触发
- 通过 `summarization.enabled` 配置项控制开关
- 一般在对话消息达到一定数量或总长度超过阈值时触发

## 工作流程

```
ExperienceSummarizer.summarize(params)
  │
  ├─ loadPrompt(configDir)
  │   → 从 config/knowledge/summarizer.md 加载总结提示
  │
  ├─ 启动独立 summarizer Agent
  │   → new AgentLauncher().launch(config, 'summarizer-<moduleName>', projectRoot)
  │   → 不使用隔离工作空间，直接在 projectRoot 运行
  │
  ├─ 构建总结 Prompt
  │   → summarizerPrompt + 历史对话内容
  │
  ├─ connection.newSession({ cwd: projectRoot })
  ├─ connection.prompt() → 等待总结结果
  │
  └─ 将总结内容追加到 experience.md
      → 路径: <modulePath>/experience.md
      → 仅保留最近 N 条经验（最多 10 条）
```

## 参数

```typescript
interface SummarizeParams {
  moduleName: string;
  chatMsgs: ChatMsg[];          // 要总结的对话消息
  projectRoot: string;
  configDir: string;            // 配置目录（加载 summarizer.md）
  agentConfig: AgentConfig;     // 用于启动总结 Agent
  logger?: Logger;
}
```

## 与 PromptBuilder 的协作

`PromptBuilder.buildPromptBlocks()` 在构建首次消息时，会调用 `loadExperienceBlock()` 读取 `experience.md` 的最新几条经验记录，将其作为上下文注入 Prompt。

这样形成了一个闭环：
1. Agent 对话 → 累积消息
2. ExperienceSummarizer → 总结为经验
3. PromptBuilder → 下次对话注入经验
4. Agent 获得历史经验 → 更精准的上下文理解
