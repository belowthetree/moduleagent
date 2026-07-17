# ModuleAgent Agent 上下文优化方案

> 基于 [DeepSeek-Reasonix 优化机制分析](./DeepSeek-Reasonix-Optimization.md) 对标制订
> 制订日期: 2026-07-16
> **实施状态更新: 2026-07-18**（见文末 [§8 实施状态](#8-实施状态2026-07-18-更新)）

---

## 目录

1. [总体评估](#1-总体评估)
2. [P0 — 必须立即实施](#2-p0--必须立即实施)
3. [P1 — 短期高收益](#3-p1--短期高收益)
4. [P2 — 中期架构增强](#4-p2--中期架构增强)
5. [P3 — 长期锦上添花](#5-p3--长期锦上添花)
6. [实施路线图](#6-实施路线图)
7. [附录：代码修改索引](#7-附录代码修改索引)
8. [实施状态（2026-07-18 更新）](#8-实施状态2026-07-18-更新)

---

## 1. 总体评估

### 1.1 ModuleAgent vs Reasonix 架构差异

| 维度 | Reasonix | ModuleAgent |
|------|----------|-------------|
| **Agent 模型** | 单 Agent + Coordinator 双模型 | 多 Agent 网格（每模块独立 Agent 进程） |
| **通信协议** | OpenAI-compatible HTTP/SSE | ACP (Agent Client Protocol) + MCP |
| **上下文隔离** | 单一对话流 + compact | **模块图沙箱隔离**（子模块对父模块不可见） |
| **工具集** | 15 核心工具 + MCP 懒加载 | 8 核心工具 + MCP bridge（跨模块委派） |
| **LLM 后端** | ai-sdk 多 Provider | ai-sdk（通过 KernelFactory） |
| **UI 层** | CLI/TUI (SolidJS) | Electron (Vue 3) + TUI (SolidJS) |

**核心结论**：ModuleAgent 的**多 Agent 网格架构本身就是一种上下文优化**——每个 Agent 只关注自己的模块上下文，通过 `module_call` 跨模块委派，而不是把所有上下文塞进一个巨大的 prompt。这是 Reasonix 所没有的架构优势。

### 1.2 优化优先级矩阵

按 **成本/收益比** 排序：

| 优先级 | 优化项 | 预计收益 | 实施成本 | 风险 |
|--------|--------|----------|----------|------|
| **P0** | 滑动窗口消息截断 | 🔴 极高 | 🟢 低 | 低 |
| **P0** | Token 计数与用量追踪 | 🔴 极高 | 🟢 低 | 低 |
| **P1** | System Prompt 缓存锚定 | 🟡 高 | 🟡 中 | 中 |
| **P1** | 工具输出智能截断 | 🟡 高 | 🟢 低 | 低 |
| **P1** | 渐进式上下文披露 | 🟡 高 | 🟡 中 | 中 |
| **P2** | 在线上下文压缩 | 🟡 高 | 🔴 高 | 高 |
| **P2** | 双模型路由 | 🟢 中 | 🟡 中 | 低 |
| **P2** | 结构化输出 | 🟢 中 | 🟡 中 | 低 |
| **P3** | 并行 Agent 执行 | 🟢 中 | 🔴 高 | 高 |
| **P3** | Checkpoint/Rewind | 🟢 中 | 🔴 高 | 高 |
| **P3** | 死循环防护 | 🟢 低 | 🟢 低 | 低 |

---

## 2. P0 — 必须立即实施

> **目标**：防止上下文窗口爆炸导致 API 调用失败，建立可观测性基础。

### 2.1 滑动窗口消息截断

**对标 Reasonix**：§1 分层压缩策略 — `softCompactRatio` / `compactRatio` / `tail_tokens`

**现状**：ModuleAgent 的 `AgentLoop.messages` 无限增长，`ChatMsg[]` 持久化到 JSON 文件也无限增长。`clearContext` 只有手动触发。

**方案**：

```
src/agents/kernel/AgentLoop.ts 中新增:

1. 配置常量 (对齐 Reasonix compact.go:24-36)
   - CONTEXT_WINDOW_TOKENS = 128000  (从 provider 配置读取，默认值)
   - SOFT_WARN_RATIO = 0.5           (50% 时日志警告)
   - TRUNCATE_RATIO = 0.8            (80% 时自动截断)
   - TAIL_MESSAGE_COUNT = 6          (保留最近 6 条消息)
   - MIN_KEEP_MESSAGES = 2           (至少保留 2 条)

2. AgentLoop.send() 中添加:
   maybeTruncateHistory() — 在 push user message 之后、调用 LLM 之前
   → 估算当前 messages 总 token 数
   → 若超过 CONTEXT_WINDOW_TOKENS * TRUNCATE_RATIO:
      保留最近 TAIL_MESSAGE_COUNT 条 + 第一条 user message(含 system context)
      中间消息截断，替换为摘要占位符: "[… earlier conversation truncated …]"
   → 日志记录截断事件 (truncated_count, remaining_count, estimated_tokens)
```

**改动文件**：
- `src/agents/kernel/AgentLoop.ts` — 新增 `maybeTruncateHistory()` 方法
- `src/agents/kernel/types.ts` — 新增 `TruncationConfig` 接口
- `src/config/defaults.ts` — 新增 `contextWindow` 配置字段

**预期效果**：
- 对话再长也不会超过窗口限制
- API 调用失败率降至 0
- 长会话稳定性大幅提升

---

### 2.2 Token 计数与用量追踪

**对标 Reasonix**：§1.2 Token 估算 — `tokPerChar()` 运行时校准

**现状**：仅有 `ChatResponse.usage` 类型定义和 `maxTokens` 配置，完全没有任何 token 计数逻辑。

**方案**：

```
Phase 1 — 轻量估算 (无外部依赖):

src/core/TokenEstimator.ts (新建)

class TokenEstimator {
  // 自适应校准 (对齐 Reasonix tokPerChar)
  private tokPerChar = 0.25;  // 默认 ~4 chars/token

  calibrateFromUsage(promptTokens: number, promptChars: number): void {
    const r = promptTokens / promptChars;
    if (r > 0.05 && r < 2) {
      this.tokPerChar = r;  // 从真实 usage 反推
    }
    // EMA 平滑: 0.7 * old + 0.3 * new
    this.tokPerChar = 0.7 * this.tokPerChar + 0.3 * r;
  }

  estimate(texts: string[]): number {
    return texts.reduce((sum, t) => sum + Math.ceil(t.length * this.tokPerChar), 0);
  }
}

Phase 2 — 精确计数 (可选，按需引入):
- 使用 tiktoken (claude/kor/...)
- 或 @anthropic-ai/tokenizer
```

**改动文件**：
- `src/core/TokenEstimator.ts` — **新建**，Token 估算器
- `src/agents/kernel/AgentLoop.ts` — `send()` 中调用 `calibrateFromUsage` + 日志输出 token 用量
- `src/core/ModuleAgentSubsystem.ts` — `sendMessage()` 返回值新增 `usage` 字段透传给 UI

**预期效果**：
- 每个 turn 输出 token 用量日志
- UI 可展示累计 token 消耗
- 为后续 Token 经济模式提供数据基础

---

## 3. P1 — 短期高收益

> **目标**：降低每次 API 调用的上下文成本，提升响应速度。

### 3.1 System Prompt 缓存锚定 (Prompt Cache Pinning)

**对标 Reasonix**：§2 Provider 前缀缓存 — `CacheShape` / `PrefixHash`

**核心原理**：多数 LLM Provider (Anthropic, DeepSeek, OpenAI) 提供 **prompt caching**——请求前缀相同时，缓存命中的 token 按 1/10 价格计费。ModuleAgent 每次 `buildPromptBlocks` 产生的 system prompt + module context 内容庞大，但如果能保证**前缀稳定**，缓存命中率可达 90%+。

**现状**：`sessionPrompted` 方案虽然在「首条消息注入完整上下文」层面做了优化，但没有从 Provider 缓存视角考虑问题。

**方案**：

```
1. 缓存友好的消息结构 (对齐 Reasonix cache_shape.go)

   AgentLoop.send() 改为:

   messages = [
     { role: 'system', content: <systemPrompt> },  // ← 永远在最前面，永远不变
     { role: 'user',   content: <moduleContext> },  // ← 首条用户消息含 module.md
     ...existingMessages...                          // ← 历史消息追加在后面
     { role: 'user',   content: <newUserText> },     // ← 当前消息
   ]

   关键约束:
   - system prompt 在整个 session 中永不改变
   - 工具 schema 排序后序列化 → 确保字节级稳定
   - 不使用动态时间戳、随机 ID、进程 PID 等不稳定信息

2. Cache 诊断日志

   AgentLoop 每次调用后记录:
   - cacheHit: boolean (从 API response 读取)
   - 若 cache miss: 记录原因 (system changed? tools changed? new session?)

3. 工具 Schema 稳定性

   在 AgentLoop 构造时 sort tools by name → JSON.stringify
   确保同一 session 中 tools 数组顺序不变
```

**改动文件**：
- `src/agents/kernel/AgentLoop.ts` — 重构消息结构为缓存友好格式
- `src/agents/prompts/PromptBuilder.ts` — system prompt 分离为独立 role: 'system' 消息
- `src/agents/kernel/ToolAdapter.ts` — 工具 schema 排序逻辑

**预期效果**：
- 缓存命中时 system prompt + module context 按 1/10 计费
- 对 DeepSeek 等缓存友好的 Provider 效果尤其显著
- 每次 API 调用 prompt token 成本降低 60-80%

---

### 3.2 工具输出智能截断

**对标 Reasonix**：§9.1 工具输出截断 — `maxToolOutputBytes` + §1.1 Stale Tool Result snip/prune

**现状**：仅 `execute-command.ts` 对命令输出做了 10000 字符硬截断。其他工具（read_file、grep 等）无截断。

**方案**：

```
1. 统一截断常量 (对齐 Reasonix agent.go:36)

   src/agents/kernel/types.ts:
   const MAX_TOOL_OUTPUT_CHARS = 8000;   // ~2K tokens

2. ToolAdapter 包装器

   src/agents/kernel/ToolAdapter.ts:

   function wrapWithTruncation(tool: Tool): Tool {
     return {
       ...tool,
       async execute(input) {
         const result = await tool.execute(input);
         if (result.content.length > MAX_TOOL_OUTPUT_CHARS) {
           const head = result.content.slice(0, 6000);
           const tail = result.content.slice(-2000);
           result.content = head
             + `\n\n[... ${result.content.length - 8000} chars truncated ...]\n\n`
             + tail;
           result.metadata = { ...result.metadata, truncated: true, originalLength: result.content.length };
         }
         return result;
       }
     };
   }

3. Stale Tool Result 归档 (Phase 2，对标 Reasonix prune.go)

   当消息历史中工具结果超过 N 轮时，替换为:
   "[tool result archived — see .module-agent/archives/<module>/turn-<N>.json]"
```

**改动文件**：
- `src/agents/kernel/ToolAdapter.ts` — 工具输出截断包装器
- `src/agents/kernel/types.ts` — 截断常量定义

**预期效果**：
- 单条工具输出不会撑爆上下文窗口
- 特别是 grep/read_file 等可能输出大量内容的工具

---

### 3.3 渐进式上下文披露 (Progressive Disclosure)

**对标 Reasonix**：§4 Token 经济模式 — `connect_tool_source` 按需连接

**现状**：`buildPromptBlocks` 在首条消息中一次性注入全部上下文：system prompt + module.md + patterns.md + experience.md。这些可能合计 5000-20000 字符。

**方案**：

```
1. 分层上下文策略

   Tier 0 (必注): system prompt (角色定义 + 规则)
   Tier 1 (首注): module.md 摘要（前 2000 字符）+ 目录结构
   Tier 2 (按需): 
     - 完整 module.md → 通过 MCP tool `module_context:read_full` 获取
     - patterns.md → 通过 MCP tool `module_context:read_patterns` 获取
     - experience.md → 通过 MCP tool `module_context:read_experience` 获取

2. PromptBuilder 改造

   buildPromptBlocks() 改为:
   - isFirst 时只注入 Tier 0 + Tier 1
   - 新增 `module_context:*` 3 个只读工具，按需获取 Tier 2 内容

3. MCP 工具注册

   mcp-bridge.ts 新增:
   - module_context_read_full(name: string): string
   - module_context_read_patterns(name: string): string  
   - module_context_read_experience(name: string, count?: number): string
```

**改动文件**：
- `src/agents/prompts/PromptBuilder.ts` — 分层注入逻辑
- `src/agents/kernel/tools/mcp-bridge.ts` — 注册 3 个 `module_context:*` 工具
- `src/agents/prompts/context.ts` — 按需读取函数

**预期效果**：
- 首条消息 token 量减少 40-70%
- Agent 只在需要时才读取完整文档
- 对简单问题（如"这个模块做什么？"）几乎不需要 Tier 2

---

## 4. P2 — 中期架构增强

> **目标**：提升 Agent 智能度和系统健壮性。

### 4.1 在线上下文压缩 (Online Compaction)

**对标 Reasonix**：§1 分层压缩策略 — `compact()` / `partitionFold()` / `summarizeWithRetry()`

**现状**：`ExperienceSummarizer` 是**异步后处理**总结，不在线。没有 token 阈值触发的在线压缩。

**方案**：

```
src/agents/kernel/ContextCompactor.ts (新建)

class ContextCompactor {
  // 触发条件 (对齐 Reasonix)
  private compactRatio = 0.7;       // 70% 触发压缩
  private compactTarget = 0.4;      // 压缩至 40%
  private tailTokenBudget = 16384;  // 保留最近 16K tokens 原文

  // 核心流程
  async maybeCompact(messages, windowTokens): Promise<Message[]> {
    if (estimatedTokens < windowTokens * this.compactRatio) return messages;

    // 1. 保留: system prompt + 最近 tailTokenBudget tokens
    // 2. 折叠: 中间消息批量总结
    // 3. 总结注入为单条 user message: "[Conversation summary: ...]"
    // 4. 原始消息写入 .module-agent/archives/<module>/compact-<N>.json

    return await this.compact(messages);
  }

  // 经济性判断 (对齐 Reasonix foldEconomics)
  private isWorthCompacting(foldableTokens: number): boolean {
    return foldableTokens >= 400;  // 至少 400 tokens 才值得
  }
}
```

**⚠️ 风险提示**：在线压缩是最复杂的优化，需要在以下方面谨慎设计：
- 压缩时不能中断正在进行的 Agent 推理
- 总结 Agent 调用引入额外延迟
- 压缩可能导致关键信息丢失

**建议**：先在 ExperienceSummarizer 上增加触发频率（从 fire-and-forget 改为每 N 轮同步执行），验证总结质量后再实现在线压缩。

**改动文件**：
- `src/agents/kernel/ContextCompactor.ts` — **新建**
- `src/agents/kernel/AgentLoop.ts` — `send()` 中集成 `maybeCompact`
- `src/agents/prompts/summarizerprompt.md` — 总结提示词优化（当前不存在此文件）

---

### 4.2 双模型路由 (Fast/Slow Model Routing)

**对标 Reasonix**：§6 双模型协调器 — `Coordinator` + §8 任务分类

**现状**：配置中有 `fastModel` 字段但**从未使用**。所有请求都走同一模型。

**方案**：

```
src/agents/kernel/ModelRouter.ts (新建)

class ModelRouter {
  // 启发式分类 (对齐 Reasonix task_classifier.go 的 heuristic 模式)
  classify(input: string): 'fast' | 'normal' {
    // 1. 短问候 (≤3 词): fast
    // 2. 简单查询 ("what is", "how many", "list"): fast
    // 3. 代码修改/文件操作: normal
    // 4. >50 词: normal
    // 5. 默认: normal
  }

  selectModel(classification, config): { model, provider } {
    if (classification === 'fast' && config.fastModel) {
      return { model: config.fastModel, provider: config.provider };
    }
    return { model: config.model, provider: config.provider };
  }
}
```

**⚠️ 注意**：ModuleAgent 没有 Reasonix 的 Planner → Executor 双 Session 架构。这里的路由只是选择模型，不涉及两个 Session 的规划-执行分离。

**改动文件**：
- `src/agents/kernel/ModelRouter.ts` — **新建**，分类 + 路由
- `src/agents/kernel/AgentLoop.ts` — `send()` 中调用 `ModelRouter.classify()` 选择模型
- `src/agents/kernel/ProviderResolver.ts` — 支持双模型配置

**预期效果**：
- 简单问题用 `fastModel`（如 DeepSeek-V3 或 Claude Haiku）
- 复杂任务用 `normalModel`（如 DeepSeek-R1 或 Claude Sonnet）
- 简单问题延迟降低 50%+，成本降低 80%+

---

### 4.3 结构化输出 (Structured Output)

**对标 Reasonix**：§8.3 Auto-Plan 分类器 — JSON Schema 输出 `{"needs_plan": true/false}`

**方案**：

```
1. 模块路由意图识别

   AgentLoop.send() 第一轮用 structured output 识别意图:
   {
     "target_module": "auth" | null,
     "intent": "query" | "modify" | "create" | "chat",
     "needs_cross_module": boolean
   }

   效果:
   - target_module 非 null → 直接路由，跳过关键词匹配
   - needs_cross_module → 预加载 MCP bridge 工具

2. 经验提取结构化

   ExperienceSummarizer 输出改为 JSON Schema:
   {
     "module_updates": [{ "section": "API", "change": "..." }],
     "experiences": [{ "title": "...", "lesson": "...", "category": "pitfall" }],
     "patterns": [{ "trigger": "...", "action": "...", "files": ["..."] }]
   }

   效果:
   - 总结解析更可靠（当前依赖自由文本，可能格式不一致）
```

**改动文件**：
- `src/agents/kernel/AgentLoop.ts` — 新增 `classifyIntent()` 方法
- `src/core/ExperienceSummarizer.ts` — 结构化输出 prompt + 解析

---

## 5. P3 — 长期锦上添花

> **目标**：完善系统能力，提升极端场景下的稳定性。

### 5.1 死循环防护 (Storm Breaker)

**对标 Reasonix**：§14 死循环防护 — `stormSig` / `stormCount` / `blockedTurnStreak`

**方案**：

```
src/agents/kernel/StormBreaker.ts (新建)

class StormBreaker {
  private stormSig = '';
  private stormCount = 0;
  private maxStorms = 3;

  detect(toolName: string, error: string): 'continue' | 'intervene' {
    const sig = `${toolName}:${this.normalizeError(error)}`;
    if (sig === this.stormSig) {
      this.stormCount++;
      if (this.stormCount >= this.maxStorms) {
        return 'intervene';  // 注入提示: "你似乎陷入了循环，请尝试不同方法"
      }
    } else {
      this.stormSig = sig;
      this.stormCount = 1;
    }
    return 'continue';
  }
}
```

**改动文件**：
- `src/agents/kernel/StormBreaker.ts` — **新建**
- `src/agents/kernel/AgentLoop.ts` — `onStepFinish` 中集成

---

### 5.2 Checkpoint 快照 (暂缓)

**对标 Reasonix**：§10 Checkpoint 快照与 Rewind

**评估**：ModuleAgent 已有 `WorkspaceDiff` 引擎（`src/core/WorkspaceDiff.ts`），且模块 Agent 通过 Sandbox 隔离文件系统。Checkpoint 对 ModuleAgent 的边际收益有限。**建议暂缓**，优先投入 P0/P1。

---

### 5.3 并行 Agent 执行 (暂缓)

**对标 Reasonix**：N/A（Reasonix 是单 Agent）

**评估**：ModuleAgent 的 `sendGuard` 互斥锁（`src/core/AgentSubsystemUtils.ts`）故意串行化模块 Agent，防止并发文件冲突。并行化需要解决：
- 文件写入冲突
- 跨模块依赖顺序
- 上下文一致性

**建议暂缓**，等 P0/P1 稳定后再考虑。

---

## 6. 实施路线图

```
Week 1-2: P0 基础建设
├── 2.1 滑动窗口消息截断 → AgentLoop
├── 2.2 Token 计数与用量追踪 → TokenEstimator
└── 配置 schema 更新 → defaults.ts + schema.ts

Week 3-4: P1 成本优化
├── 3.1 System Prompt 缓存锚定 → AgentLoop + PromptBuilder
├── 3.2 工具输出智能截断 → ToolAdapter
└── 3.3 渐进式上下文披露 → PromptBuilder + mcp-bridge

Week 5-6: P2 智能增强
├── 4.2 双模型路由 → ModelRouter
├── 4.3 结构化输出 → AgentLoop + ExperienceSummarizer
└── (4.1 在线压缩 → 评估后决定)

Week 7+: P3 完善
├── 5.1 死循环防护 → StormBreaker
└── 持续监控 + 调优
```

---

## 7. 附录：代码修改索引

### 新建文件

| 文件 | 用途 | 优先级 |
|------|------|--------|
| `src/core/TokenEstimator.ts` | Token 估算器（自适应校准） | P0 |
| `src/agents/kernel/ContextCompactor.ts` | 在线上下文压缩 | P2 |
| `src/agents/kernel/ModelRouter.ts` | 快/慢模型分类路由 | P2 |
| `src/agents/kernel/StormBreaker.ts` | 死循环检测 | P3 |
| `config/knowledge/summarizerprompt.md` | 总结 Agent 系统提示词 | P2 |

### 修改文件

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `src/agents/kernel/AgentLoop.ts` | 消息截断 + 缓存友好结构 + token 校准 + 结构化输出 | P0/P1/P2 |
| `src/agents/kernel/types.ts` | TruncationConfig + 截断常量 | P0/P1 |
| `src/agents/kernel/ToolAdapter.ts` | 工具输出截断包装器 + schema 排序 | P1 |
| `src/agents/prompts/PromptBuilder.ts` | 缓存友好 system prompt + 分层注入 | P1 |
| `src/config/defaults.ts` | contextWindow / truncation 配置字段 | P0 |
| `src/config/schema.ts` | Zod schema 同步 | P0 |
| `src/core/ModuleAgentSubsystem.ts` | usage 字段透传 | P0 |
| `src/agents/kernel/ProviderResolver.ts` | 双模型支持 | P2 |
| `src/core/ExperienceSummarizer.ts` | 结构化输出 | P2 |
| `src/agents/kernel/tools/mcp-bridge.ts` | module_context:* 工具 | P1 |

### 不改动（保持现有设计）

| 组件 | 原因 |
|------|------|
| `AgentSandbox` | 模块图隔离已经是独特的上下文优化 |
| `SendGuard` | 互斥锁保障文件一致性 |
| `sessionPrompted` | 作为缓存锚定的基础保留 |
| `ExperienceSummarizer` | 异步总结架构合理，P2 增强即可 |
| `SessionStore` | JSON 持久化方案对当前规模足够 |

---

## 8. 实施状态（2026-07-18 更新）

### 8.1 各优化项状态总览

| 方案条目 | 状态 | 实现说明 |
|---------|------|---------|
| 2.1 滑动窗口截断 | ✅ 已实现（超越方案） | `HistoryTruncator.ts`：按 **token 预算**（16K）保留尾部，比方案的固定条数更贴近 Reasonix；`AgentLoop.ts` Step 2 接入 |
| 2.2 Token 计数与校准 | ✅ 已实现 | `TokenEstimator.ts`（EMA 校准）；usage 透传 UI（`ModuleAgentSubsystem.ts` → `shared.ts`） |
| 3.1 System Prompt 缓存锚定 | ✅ 已实现 | 系统提示经 `Agent.start({ systemPrompt })` 以独立 system 角色注入（模块：`ModuleAgentSubsystem._startAgentInternal`；角色：`RoleAgentManager`）；`PromptBuilder`/`RoleAgentSubsystem` 不再混入首条 user 消息；工具 schema 按名排序（既有）。Cache 诊断日志未做 |
| 3.2 工具输出智能截断 | ✅ 已实现 | `ToolOutputTruncator.ts` 分工具规则，接入 `ToolAdapter.ts`；Phase 2 归档由 60% snip 层实现（见下） |
| 3.3 渐进式上下文披露 | ✅ 已实现 | 非根模块首条消息仅注入 module.md 前 2000 字符 + 按需获取指引；`module_context_read_*` 工具既有；`progressiveDisclosure` 配置默认开启；`subagentprompt.md` 已补充工具规则 |
| 4.1 在线上下文压缩 | ✅ 已实现（已救活） | `ContextCompactor.ts` + fastModel 摘要 + 失败降级截断。**关键修复**：配置管道此前断裂（`AgentKernel` 未透传 `truncation`/`compaction`），本轮已全链路打通（schema → defaults → Subsystem → Agent → KernelFactory → AgentKernel → AgentLoop） |
| 4.2 双模型路由 | ✅ 已实现 | `ModelRouter.ts` 启发式分类 + `fastModel` per-module 覆盖 |
| 4.3 结构化输出 | ❌ 未实现 | 无 `classifyIntent` / `generateObject`；`ExperienceSummarizer` 仍为自由文本 |
| 5.1 死循环防护 | ✅ 已实现 | `StormBreaker.ts`（`AgentLoop.ts` `onStepFinish` 接入） |
| 5.2 Checkpoint 快照 | ⏸️ 决议不做（本期） | 2026-07-18 评审决议暂缓 |
| 5.3 并行 Agent 执行 | ⏸️ 暂缓 | 同原方案 |

### 8.2 方案外新增（对标 Reasonix 第二轮评审）

| 优化项 | 状态 | 实现 |
|--------|------|------|
| 跨模块调用治理（Reasonix §11） | ✅ | `CallChain.ts`（AsyncLocalStorage 传播调用链，含 `Agent.send` 排队时 `snapshot()` 保链）；环检测、maxHops=3、wait-for 死锁检测、120s 超时；`routeCall` 改走 `Agent.send` 队列修复 `AgentLoop.messages` 重入；`Agent.send` 改为返回结果。配置 `crossModule.maxHops/timeoutMs` |
| 请求重试（Reasonix §7） | ✅ | `RetryPolicy.ts`：指数退避+抖动+`Retry-After`+错误分类；LLM 外层重试由 `stepsCompleted===0` 门控（防副作用工具重复执行），内层 `maxRetries: 2`；模块/角色 spawn 失败重试 1 次（幂等复查） |
| SessionStore 磁盘封顶 | ✅ | `SessionStore` 200 条 / 5MB 上限（`contextHistoryLimit` 可配），溢出写 `archives/<module>/context-overflow.jsonl` |
| 60% 旧工具结果 snip（Reasonix §1.1/§9.2） | ✅ | `ToolResultSnipper.ts`：零 LLM 成本，跳过 head+最近 4 条，复用 `TOOL_TRUNCATION_RULES`，处理 ai-sdk tool 消息结构；`AgentLoop` 执行顺序 **snip(0.6) → compact(0.7) → truncate(0.8)** |
| 丢弃内容存档（Reasonix §1.1） | ✅ | `ArchiveWriter.ts`：snip/truncate/compact 丢弃内容统一写 `.module-agent/archives/<module>/*.jsonl`，fire-and-forget |
| 50% 上下文用量通知（Reasonix §1.1 softCompactRatio） | ✅ | `LoopEvents.onContextUsage` → `context_usage` 通知 → UI 系统消息；0.5/0.4 滞回防刷屏 |

### 8.3 本轮新增/修改文件

**新建**（4）：

| 文件 | 用途 |
|------|------|
| `src/agents/mcp/CallChain.ts` | AsyncLocalStorage 跨模块调用链追踪 |
| `src/core/RetryPolicy.ts` | 通用重试（退避/抖动/Retry-After/错误分类） |
| `src/agents/kernel/ToolResultSnipper.ts` | 60% 旧工具结果精简层 |
| `src/agents/kernel/ArchiveWriter.ts` | jsonl 存档写入器 |

**修改**（18）：`Agent.ts`（send 返回结果 + ALS snapshot 队列）、`McpBackend.ts`（routeCall 治理）、`AgentLoop.ts`（snip/重试/用量事件/存档接入）、`AgentKernel.ts`、`KernelFactory.ts`、`types.ts`、`HistoryTruncator.ts`、`ContextCompactor.ts`、`StreamAccumulator.ts`（磁盘封顶）、`ModuleAgentSubsystem.ts`（systemPrompt/配置透传/用量通知）、`ModuleAgentCore.ts`、`RoleAgentManager.ts`、`RoleAgentSubsystem.ts`、`PromptBuilder.ts`（Tier1 摘要）、`projectHandlers.ts`、`schema.ts`/`defaults.ts`（新配置项）、`config/knowledge/subagentprompt.md`。

### 8.4 新增配置项

```jsonc
{
  "truncation":  { "contextWindow": 128000, "truncateRatio": 0.8, "tailTokenBudget": 16384, "minKeepMessages": 2, "snipRatio": 0.6 },
  "compaction":  { "enabled": true, "compactRatio": 0.7, "tailTokenBudget": 16384, "minIntervalMs": 60000 },
  "crossModule": { "maxHops": 3, "timeoutMs": 120000 },
  "contextHistoryLimit": 200,
  "progressiveDisclosure": true
}
```

### 8.5 遗留事项

1. **4.3 结构化输出**（意图识别 + ExperienceSummarizer JSON Schema）
2. **Cache 诊断日志**（3.1 的 cacheHit/miss 归因，依赖 Provider 返回字段）
3. **90% 强制压缩层**（Reasonix compactForceRatio，当前 truncate 兜底已覆盖）
4. **Checkpoint/Rewind**（本期决议不做）
5. 验证方式：`pnpm run typecheck`（错误数与基线一致）、`pnpm run test`（失败项与基线一致，均为既有 TUI/Windows 路径问题）
