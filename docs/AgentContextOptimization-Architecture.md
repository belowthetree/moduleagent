# ModuleAgent 上下文优化 — 架构与模块设计

> 基于 `DeepSeek-Reasonix-Optimization.md` 对标 + 当前架构分析
> 设计日期: 2026-07-16
> **修订: 2026-07-22** — 本文所述 P0–P3 优化已全部落地（另新增方案外的 `ToolResultSnipper` 与 `ArchiveWriter`），本文已按实现现状（as-built）修订：消息历史全程为 ai-sdk `ModelMessage[]`（compact/truncate 直接操作结构化消息，保持 tool-call/tool-result 配对），`response.messages` 只含本次新生成的消息、必须**追加**而非替换。与代码冲突时以 `src/agents/kernel/` 为准。

---

## 1. 架构全景与优化切面

### 1.1 当前分层

```
┌─────────────────────────────────────────────────┐
│  UI Layer: Vue 3 (Electron) / SolidJS (TUI)     │
├─────────────────────────────────────────────────┤
│  Bridge: ElectronBridge / TuiBridge              │  ← CoreCallbacks
├─────────────────────────────────────────────────┤
│  Core: ModuleAgentCore → ModuleAgentSubsystem    │  ← sendMessage / clearContext
├─────────────────────────────────────────────────┤
│  Agent: Agent → AgentKernel → AgentLoop          │  ← ★ 优化主战场
│         ├── Sandbox (路径隔离)                    │
│         ├── ToolRegistry → ToolAdapter           │  ← ★ 工具输出截断
│         ├── PromptBuilder (prompt 构建)           │  ← ★ 缓存友好 + 渐进披露
│         └── ProviderResolver (模型解析)           │  ← ★ 模型路由
├─────────────────────────────────────────────────┤
│  ai-sdk (generateText)                           │  ← LLM 调用
└─────────────────────────────────────────────────┘
```

### 1.2 优化切入点总览（as-built）

```
                    ┌──────────────────────┐
                    │   TokenEstimator     │  已实现: 自适应 Token 估算
                    ├──────────────────────┤
                    │   ToolResultSnipper  │  已实现(方案外新增): 60% 旧工具结果 snip
                    ├──────────────────────┤
  AgentLoop ────────┤   ContextCompactor   │  已实现: 在线压缩（70%）
  (send 管道)       ├──────────────────────┤
                    │   HistoryTruncator   │  已实现: 滑动窗口截断（80%）
                    ├──────────────────────┤
                    │   ModelRouter        │  已实现: 快/慢模型路由
                    ├──────────────────────┤
                    │   StormBreaker       │  已实现: 死循环检测
                    ├──────────────────────┤
                    │   ArchiveWriter      │  已实现(方案外新增): 丢弃内容 jsonl 存档
                    └──────────────────────┘

                    ┌──────────────────────┐
  ToolAdapter ──────┤   ToolOutputTruncator│  已实现: 工具输出截断
                    └──────────────────────┘

                    ┌──────────────────────┐
  PromptBuilder ────┤   CacheFriendlyPrompt│  已实现: system prompt 独立注入
                    ├──────────────────────┤
                    │   ProgressiveDisclose│  已实现: Tier-1 摘要 + module_context_* 工具
                    └──────────────────────┘
```

---

## 2. P0 — TokenEstimator（Token 估算器）

### 2.1 设计目标

- **零外部依赖**：不用 tiktoken / anthropic tokenizer，用运行时校准
- **对标 Reasonix**：`tokPerChar()` 自适应校准 + EMA 平滑
- **职责单一**：只做估算，不涉及截断/压缩决策

### 2.2 接口

```typescript
// src/core/TokenEstimator.ts

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class TokenEstimator {
  // ── 配置 ──
  private tokPerChar: number = 0.25;    // 默认 ~4 chars/token
  private readonly emaAlpha = 0.3;      // EMA 平滑系数
  private calibrated = false;

  // ── 公开 API ──

  /** 从 Provider 返回的真实 usage 反推校准（as-built: 第二参数为字符数） */
  calibrate(usage: TokenUsage, promptChars: number): void {
    if (usage.promptTokens <= 0 || promptChars <= 0) return;
    const r = usage.promptTokens / promptChars;
    if (r < 0.05 || r > 2) return;  // 异常值拒绝
    this.tokPerChar = (1 - this.emaAlpha) * this.tokPerChar + this.emaAlpha * r;
    this.calibrated = true;
  }

  /** 估算文本 token 数 */
  estimate(text: string): number {
    return Math.ceil(text.length * this.tokPerChar);
  }

  /** 批量估算 */
  estimateAll(texts: string[]): number {
    return texts.reduce((sum, t) => sum + this.estimate(t), 0);
  }

  /** 估算 ChatMessage 数组的总 prompt token */
  estimateMessages(messages: Array<{ role: string; content: string }>): number {
    // 每条消息有 ~4 token 的格式开销（role + 分隔符）
    const overhead = messages.length * 4;
    return overhead + this.estimateAll(messages.map(m => m.content));
  }

  /** 是否已校准 */
  get isCalibrated(): boolean { return this.calibrated; }

  /** 当前校准值（调试用） */
  get currentRatio(): number { return this.tokPerChar; }
}
```

### 2.3 集成点

```
AgentLoop.constructor()
  └→ this.tokenEstimator = new TokenEstimator()

AgentLoop.send() — LLM 调用完成后:
  └→ const usage = result.usage  // { promptTokens, completionTokens }
  └→ this.tokenEstimator.calibrate(usage, promptChars)  // promptChars = 全部消息 slim 文本 + systemPrompt 字符数
  └→ logger.info(`[AgentLoop] tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens}`)

ModuleAgentSubsystem.sendMessage() — 透传:
  └→ return { result: { ..., usage: { promptTokens, completionTokens, totalTokens } } }
  └→ UI 层展示累计 token
```

### 2.4 数据流

```
AgentLoop        TokenEstimator        Provider (ai-sdk)
  │                    │                      │
  │  send(blocks)      │                      │
  ├──────────────────────────────────────────►│
  │                    │        generateText  │
  │◄──────────────────────────────────────────┤
  │  result.usage      │                      │
  │                    │                      │
  │──calibrate(usage)─►│                      │
  │                    │ tokPerChar ← EMA     │
  │◄───estimate()──────│                      │
  │                    │                      │
  │  logger.info       │                      │
```

---

## 3. P0 — HistoryTruncator（滑动窗口截断器）

### 3.1 设计目标

- 在 **AgentLoop.send()** 调用 LLM **之前**检查消息历史长度
- 不改变 AgentLoop 的外部接口
- 保留策略：最近 N 条 + 第一条 user message（含 system context）+ system prompt

### 3.2 接口

```typescript
// src/agents/kernel/HistoryTruncator.ts（as-built）

export interface TruncationConfig {
  /** 上下文窗口总 token 数（从 provider 配置获取，默认 128K） */
  contextWindow: number;
  /** 触发截断的阈值比例（默认 0.8，对齐 Reasonix compactRatio） */
  truncateRatio: number;
  /** 截断后保留最近消息的 token 预算（默认 16384，对齐 Reasonix tail_tokens） */
  tailTokenBudget: number;
  /** 最小保留消息数（默认 2，对齐 Reasonix minRecentKeep） */
  minKeepMessages: number;
  // 注：占位文本不再是配置字段，改为构造函数参数 marker
  // （默认 '[… 较早的对话已被截断以节省上下文空间 …]'）
}

export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  contextWindow: 128_000,
  truncateRatio: 0.8,
  tailTokenBudget: 16_384,
  minKeepMessages: 2,
};

export interface TruncationResult {
  /** 截断结果 [marker?, ...tail]——不包含 head，head 由调用方（AgentLoop）单独保留拼接 */
  messages: ModelMessage[];
  /** 被移除的消息数 */
  truncatedCount: number;
  /** 截断前估算 token 数 */
  beforeTokens: number;
  /** 截断后估算 token 数 */
  afterTokens: number;
}

// token 估算辅助：ModelMessage 的结构化 content 序列化为纯文本
export function slimContent(msg: ModelMessage): string;
export function slimMessages(messages: ModelMessage[]): Array<{ role: string; content: string }>;

export class HistoryTruncator {
  constructor(
    config: Partial<TruncationConfig> = {},
    estimator: TokenEstimator,
    marker?: string,
    logger?: Logger,
    archive?: (records: ModelMessage[]) => void,  // 被丢弃消息存档（ArchiveWriter）
  );

  /**
   * 截断消息历史（直接操作 ai-sdk ModelMessage[]）。
   *
   * 保留规则（对齐 Reasonix planCompaction）：
   * 1. 始终保留第一条 user message（head，承载 module context 注入）——
   *    head 不在返回值中，调用方自行拼接 [head, ...result]
   * 2. 从尾部向前累计，直到达到 tailTokenBudget 或 minKeepMessages
   * 3. 被截断的中间消息合并为一条 marker 占位消息（role: 'user'）
   * 4. tail 不允许以 tool 消息开头——其对应的 assistant tool-call 已被截断，
   *    孤儿 tool 消息会破坏 ModelMessage 序列结构（丢弃尾部前导 tool 消息）
   * 5. 被丢弃的中间消息经 archive 回调写入 archives/history-truncated.jsonl
   */
  truncate(messages: ModelMessage[]): TruncationResult;

  /** 更新配置（运行时调整） */
  updateConfig(partial: Partial<TruncationConfig>): void;
}
```

### 3.3 集成点 — AgentLoop.send()（as-built）

```
send(blocks) {
  const userText = blocks.map(b => b.text).join('\n');
  this.messages.push({ role: 'user', content: userText });       // ← push

  // Step 0: 旧工具结果 snip（ToolResultSnipper，60% 阈值，零 LLM 成本，原地修改）
  this.toolResultSnipper.snipStale(this.messages, this.contextWindow);

  // Step 1: 在线压缩（ContextCompactor，70% 阈值，仅 compaction.enabled 且有 fastModel 时）
  //         成功则 this.messages = compactResult.messages（head + summary + tail）

  // Step 2: 滑动窗口截断（HistoryTruncator，80% 阈值）
  const truncResult = this.historyTruncator.truncate(this.messages);
  if (truncResult.truncatedCount > 0) {
    // 返回值不含 head——用原 head 拼接 [head, marker, ...tail]
    this.messages = [this.messages[0], ...truncResult.messages];
  }

  // Step 3: ModelRouter 选择 fastModel / 主模型

  // Step 4: generateText（withRetry 外层重试，stepsCompleted===0 门控）
  const result = await withRetry(() => generateText({
    model: activeModel,
    system: this.systemPrompt,
    messages: this.messages,
    ...
  }));

  // ⚠️ 关键（ai-sdk v7）: response.messages 只含本次调用新生成的消息，
  // 必须【追加】而非替换——替换会丢弃刚 push 的 user 消息与全部历史
  this.messages.push(...result.response.messages);

  // token 校准（promptChars = slim 消息文本 + systemPrompt 字符数）
  if (result.usage) this.tokenEstimator.calibrate(result.usage, promptChars);
}
```

### 3.4 ⚠️ 关键注意事项（as-built 定论）

1. **ai-sdk v7 的 `result.response.messages` 只包含本次调用新生成的消息**（assistant + tool 消息），不含传入的历史。必须用 `this.messages.push(...result.response.messages)` **追加**；早期的「替换」写法会每轮丢弃 user 消息与全部历史——这是 2026-07 修复轮修掉的关键 bug。

2. **第一条 user message 必须保留**：它承载了 `buildPromptBlocks` 注入的全部 module context。若截断它，后续轮次丢失模块上下文。`truncate()` 返回值刻意不含 head，由 AgentLoop 拼接 `[head, ...result]`。

3. **tool_call↔tool_result 配对保护已实现**：`HistoryTruncator` 与 `ContextCompactor` 直接操作 `ModelMessage[]`（不再 JSON 字符串化），并保证 tail 不以孤儿 tool 消息开头（其 assistant tool-call 落在被截断/折叠区），保持消息序列结构合法。

---

## 4. P1 — CacheFriendlyPrompt（缓存友好的 Prompt 结构）

### 4.1 设计目标

- 让 Provider 的 **prompt prefix cache** 能最大化命中
- 核心原则：**system prompt 在整个 session 中永不改变，放在请求最前面**
- 对标 Reasonix：PrefixShape / CacheShape 追踪

### 4.2 关键认知

> 状态：**已完成改造**。以下为改造前（2026-07 之前）的问题描述；现 system prompt 经 `Agent.start({ systemPrompt })` 以独立 `system` 角色消息注入，`PromptBuilder.buildPromptBlocks()` 不再将其混入首条 user 消息（前缀缓存锚定）。

改造前架构的问题：
```
// 当前 AgentLoop.send():
const userText = blocks.map(b => b.text).join('\n');  // system prompt + module context 混在 user text 里
this.messages.push({ role: 'user', content: userText });
await generateText({
  system: this.systemPrompt,  // ← 这个字段存在但没有被使用
  messages: this.messages,
});
```

`systemPrompt` 字段虽然传给了 ai-sdk，但 `PromptBuilder.buildPromptBlocks()` 把 system prompt 内容放在了首个 `PromptBlock` 中，作为 user message 注入。这导致：
- system prompt 不在前缀位置，缓存无法命中
- 每次新 turn 的 user message 变化导致整个前缀失效

### 4.3 方案：分离 system prompt 到独立 system 消息

> as-built：落地路径与设计略有不同——`PromptBuilder.buildPromptBlocks()` 不返回 `BuildResult`，而是 system prompt 经 `Agent.start({ systemPrompt })` → `KernelFactory` → `AgentLoopConfig.systemPrompt` 独立传递，由 `AgentLoop` 在每次 `generateText({ system })` 时注入；`buildPromptBlocks()` 的首个 block 只含 module context（Tier-1 摘要），`sessionPrompted` 集合保证每会话仅注入一次。

```
设计要点（与实现一致的部分）：
改造后的 PromptBuilder.buildPromptBlocks():

// 不再把 system prompt 混入 blocks
// 而是单独返回一个 systemPrompt 字符串
export interface BuildResult {
  systemPrompt: string;       // ← 独立返回，传给 AgentLoop 的 system 参数
  contextBlock: PromptBlock;  // ← 首条 user message（module context only，不含 system prompt）
  userBlock: PromptBlock;     // ← 用户消息
}

AgentLoop 改造:

class AgentLoop {
  private systemPrompt: string;  // ← 构造时设置，整个 session 不变

  async send(blocks: PromptBlock[]): Promise<...> {
    // blocks 现在是 [contextBlock?, userBlock]
    const userText = blocks.map(b => b.text).join('\n');
    this.messages.push({ role: 'user', content: userText });

    const result = await generateText({
      system: this.systemPrompt,   // ← ★ system 在最前面，永远不变 → 缓存友好!
      messages: this.messages,
      tools: this.tools,           // ← 工具排序后 JSON 稳定
    });
  }
}
```

### 4.4 工具 Schema 排序（补充，已实现）

`AgentLoop` 构造时按工具名排序后再 `convertToolsToAISDK`，保证 schema 字节级稳定：

```typescript
// AgentLoop.constructor() 中:
this.tools = convertToolsToAISDK(config.tools);  // ← 当前

// 改为:
const sortedTools = [...config.tools].sort((a, b) => a.name.localeCompare(b.name));
this.tools = convertToolsToAISDK(sortedTools);   // ← 排序后 JSON 稳定
```

### 4.5 Cache 诊断日志（未实现）

> 状态：**未落地**（依赖 Provider 返回的缓存字段，见 OptimizationPlan §8.5 遗留事项）。以下为设计草案。

```typescript
// AgentLoop.send() — LLM 调用后:
const result = await generateText({ ... });

// 从 response headers 读取缓存信息 (ai-sdk 在 v4+ 支持)
const responseHeaders = (result as any).response?.headers;
if (responseHeaders) {
  const cacheHit = responseHeaders['x-should-retry'] === undefined; // Anthropic-specific
  this.logger.info(`[AgentLoop] cache: ${cacheHit ? 'HIT' : 'MISS'}`);
}
```

### 4.6 数据流对比

```
改造前 (每次请求前缀都变):
  Turn 1: [user: system+ctx+msg1]              ← 前缀 ∅ → MISS → 全价
  Turn 2: [user: system+ctx+msg1, agent: r1, user: msg2]  ← 前缀变了 → MISS → 全价
  Turn 3: [user: system+ctx+msg1, agent: r1, user: msg2, agent: r2, user: msg3]  ← 前缀又变了

改造后 (system 稳定在前缀):
  Turn 1: system: [system prompt]              ← 前缀 ∅ → MISS → 全价
          user:   [module context + msg1]
  Turn 2: system: [system prompt]              ← 前缀相同 → HIT → 1/10 价!
          user:   [module context + msg1]
          assistant: [r1]
          user:   [msg2]                       ← 只有这里新增 → 增量计费
  Turn 3: system: [system prompt]              ← 前缀相同 → HIT!
          ...
```

---

## 5. P1 — ProgressiveDisclosure（渐进式上下文披露）

### 5.1 设计目标

- 首条消息不注入完整 module.md / patterns.md / experience.md
- 改为提供 **按需查询工具**
- 对标 Reasonix 的 `connect_tool_source` 理念

### 5.2 分层注入策略

```
Tier 0 — 必注 (system prompt)
  ├── mainagentprompt.md / subagentprompt.md
  └── 角色定义、规则、工具说明

Tier 1 — 首注 (首条 user message)
  ├── module.md 摘要 (前 2000 字符)
  ├── 模块目录结构 (ls 快照)
  └── 提示:「如需完整文档，请使用 module_context_read_full 工具」

Tier 2 — 按需 (通过工具获取)
  ├── module_context_read_full      → 完整 module.md
  ├── module_context_read_patterns  → patterns.md
  └── module_context_read_experience → experience.md (最近 N 条)
```

### 5.3 接口设计（as-built）

未新建 `ProgressiveDisclosure.ts`——功能拆在两个现有模块中：

```typescript
// src/agents/prompts/PromptBuilder.ts — Tier-1 摘要注入
const TIER1_SUMMARY_CHARS = 2000;

// buildPromptBlocks() 内：progressiveDisclosure（默认 true）且非根模块时，
// 首条 user 消息只注入 module.md 前 2000 字符摘要 + 按需工具指引，
// 而非完整 module.md / patterns.md / experience.md
function buildTier1SummaryBlock(moduleName: string, body: string): string;

// src/agents/kernel/tools/module-context.ts — Tier-2 按需工具
// 工具在【调用时】从模块文档目录（.module-agent/module/<name>/）惰性读取文件，
// 而非像设计中那样在启动时预加载 DisclosureTiers
export function createModuleContextTools(moduleDir: string): Tool[];
//   ├─ module_context_read_full       → 读 module.md 全文
//   ├─ module_context_read_patterns   → 读 patterns.md 全文
//   └─ module_context_read_experience → 读 experience.md，按 '## ' 分节取最近 N 条（默认 3）
```

### 5.4 工具注册（as-built）

三个工具的定义与设计的参数/行为一致（`module_context_read_experience` 支持 `count` 参数，默认 3），差别仅在内容来源：调用时经 `fs.readFile` 从 `moduleDir` 读取，文件不存在时返回「(暂无 …)」占位文本。完整实现见 `src/agents/kernel/tools/module-context.ts`。

### 5.5 集成点 — AgentKernel（as-built）

```
// AgentKernel 构造函数 — options.moduleDir 存在时注册：
if (options.moduleDir) {
  const ctxTools = createModuleContextTools(options.moduleDir);
  this.registry.registerAll(ctxTools);   // 3 个 module_context_* 工具
}
```

---

## 6. P1 — ToolOutputTruncator（工具输出截断）

### 6.1 设计目标

- 包装每个 Tool 的 execute()，限制输出大小
- 对标 Reasonix：`maxToolOutputBytes = 32KB` + §9.2 Stale Tool Result snip

### 6.2 接口

> as-built：接口与设计一致；`TOOL_TRUNCATION_RULES` 另有追加条目——`file_write`/`file_edit`（4K）、`module_call`（50K）/`module_query`（20K）/`module_list`（10K）、`module_context_read_*`（20K–100K，按需文档尽量保留）。该规则表同时被 `ToolResultSnipper` 复用。

```typescript
// src/agents/kernel/ToolOutputTruncator.ts

export interface TruncationRule {
  /** 最大输出字符数 */
  maxChars: number;
  /** 保留头部字符数 */
  headChars: number;
  /** 保留尾部字符数 */
  tailChars: number;
}

export const TOOL_TRUNCATION_RULES: Record<string, TruncationRule> = {
  // 默认规则
  __default__: { maxChars: 8_000, headChars: 6_000, tailChars: 2_000 },

  // 只读工具：保留更多头部（文件内容）
  file_read:  { maxChars: 12_000, headChars: 10_000, tailChars: 2_000 },
  search:     { maxChars: 10_000, headChars: 8_000,  tailChars: 2_000 },

  // 命令执行：保留更多尾部（错误信息常出现在末尾）
  execute_command: { maxChars: 10_000, headChars: 4_000, tailChars: 6_000 },
  // 对标 Reasonix: 有副作用工具保留更多尾部
  // read-only: front 80 lines + back 12 lines
  // bash:       front 40 lines + back 40 lines

  // 文件列表：通常不长，阈值放宽
  list_files: { maxChars: 20_000, headChars: 18_000, tailChars: 2_000 },
};

export class ToolOutputTruncator {
  /**
   * 包装 Tool.execute，在输出超限时自动截断
   */
  static wrap(tool: Tool): Tool {
    const rule = TOOL_TRUNCATION_RULES[tool.name] || TOOL_TRUNCATION_RULES.__default__;

    return {
      ...tool,
      async execute(input) {
        const result = await tool.execute(input);
        if (result.content.length <= rule.maxChars) return result;

        const head = result.content.slice(0, rule.headChars);
        const tail = result.content.slice(-rule.tailChars);
        const truncated = rule.maxChars - rule.headChars - rule.tailChars;

        return {
          content: head
            + `\n\n[... ${truncated} 字符已截断，原始长度 ${result.content.length} ...]\n\n`
            + tail,
          metadata: {
            ...result.metadata,
            truncated: true,
            originalLength: result.content.length,
          },
        };
      },
    };
  }

  /**
   * 批量包装
   */
  static wrapAll(tools: Tool[]): Tool[] {
    return tools.map(t => ToolOutputTruncator.wrap(t));
  }
}
```

### 6.3 集成点 — ToolAdapter

```
// ToolAdapter.ts — convertToolsToAISDK() 改造:

export function convertToolsToAISDK(tools: Tool[]): Record<string, any> {
  // 先截断包装
  const wrapped = ToolOutputTruncator.wrapAll(tools);

  const result: Record<string, any> = {};
  for (const t of wrapped) {
    Object.assign(result, convertToolToAISDK(t));
  }
  return result;
}
```

---

## 7. P2 — ModelRouter（双模型路由）

### 7.1 设计目标

- 简单问题用 `fastModel`（便宜/快），复杂任务用 `model`（强/贵）
- 启发式分类，不需要额外 LLM 调用
- 对标 Reasonix：§8.2 启发式分类器

### 7.2 接口

> as-built：分类规则与设计一致（6 条规则同序）；关键词表略有扩充（fast 增加 'how to'/'怎么'/'如何'，codeAction 增加 'debug'/'调试'/'optimize'/'优化'），每次判定经 logger 输出 reason。

```typescript
// src/agents/kernel/ModelRouter.ts

export type RouteDecision = 'fast' | 'normal';

export interface RouteContext {
  userText: string;
  hasFileReferences: boolean;   // 是否引用了文件路径
  hasCodeActions: boolean;      // 是否包含代码操作关键词
  messageLength: number;        // 用户输入长度
  turnNumber: number;           // 当前会话轮次
}

export class ModelRouter {
  private readonly fastKeywords = [
    '是什么', 'what is', 'how many', 'list', '列出',
    'show', '显示', 'explain', '解释', 'describe', '描述',
  ];

  private readonly codeActionKeywords = [
    'fix', '修复', 'create', '创建', 'write', '写', '编写',
    'edit', '修改', 'change', '改', 'add', '添加', 'delete', '删除',
    'refactor', '重构', 'implement', '实现', 'build', '构建',
    'run', '运行', 'test', '测试', 'deploy', '部署',
  ];

  /**
   * 启发式分类 (对齐 Reasonix task_classifier.go 的 heuristic 模式)
   */
  classify(ctx: RouteContext): RouteDecision {
    // 1. 短问候 (≤3 词): fast
    const words = ctx.userText.trim().split(/\s+/);
    if (words.length <= 3 && !ctx.hasFileReferences && !ctx.hasCodeActions) {
      return 'fast';
    }

    // 2. 简单查询关键词: fast
    const lower = ctx.userText.toLowerCase();
    const hasFastKeyword = this.fastKeywords.some(k => lower.includes(k));
    const hasCodeKeyword = this.codeActionKeywords.some(k => lower.includes(k));
    if (hasFastKeyword && !hasCodeKeyword && !ctx.hasFileReferences) {
      return 'fast';
    }

    // 3. 文件引用 / 代码操作: normal
    if (ctx.hasFileReferences || hasCodeKeyword) {
      return 'normal';
    }

    // 4. 长消息 (>100 字符): normal
    if (ctx.messageLength > 100) {
      return 'normal';
    }

    // 5. 第 1 轮: normal (确保首次注入 module context 时用强模型)
    if (ctx.turnNumber === 1) {
      return 'normal';
    }

    // 6. 默认: fast
    return 'fast';
  }
}
```

### 7.3 集成点 — AgentLoop 改造

```
AgentLoop.constructor():
  this.modelRouter = new ModelRouter();
  // 解析两个模型
  this.fastModel = config.kernelConfig.fastModel
    ? resolveLanguageModel({ ...config.kernelConfig, model: config.kernelConfig.fastModel })
    : null;

AgentLoop.send() — 选择模型（as-built: 私有 selectModel(userText) 方法）:
  const routeCtx: RouteContext = {
    userText,
    hasFileReferences: /[@.\/\\]/.test(userText) || /\.(go|js|ts|py|rs|java|md)/.test(userText),
    hasCodeActions: /fix|修复|create|创建|write|写|edit|修改|delete|删除|refactor|重构|implement|实现/.test(userText),
    messageLength: userText.length,
    turnNumber: this.messages.filter(m => m.role === 'user').length,
  };
  const decision = this.modelRouter.classify(routeCtx);
  const activeModel = decision === 'fast' ? this.fastModel : this.model;  // fastModel 字段本身即解析后的 model

  const result = await generateText({
    model: activeModel,  // ← 动态选择
    ...
  });
```

---

## 8. P2 — ContextCompactor（在线上下文压缩）

### 8.1 设计目标

- 对标 Reasonix §1 分层压缩：`maybeCompact()` → 分区 → `summarize()`
- **降级安全**：总结失败时回退到 HistoryTruncator 的机械截断
- 与 HistoryTruncator 协同：compactor 在截断之前先尝试"智能压缩"
- as-built 注记：仅当 `compaction.enabled` 且配置了 `fastModel` 时才创建（fastModel 即 summarizer）；`maybeCompact()` 在 `send()` 管道内同步 await（设计中的"异步不阻塞"未采用），但 summarizer 调用带 `withRetry`（最多 2 次）与 `minIntervalMs` 频率控制

### 8.2 接口（as-built）

```typescript
// src/agents/kernel/ContextCompactor.ts

export interface CompactionConfig {
  /** 触发压缩的 token 阈值比例（默认 0.7） */
  compactRatio: number;
  /** 保留原文的尾部 token 预算（默认 16384，对齐 Reasonix） */
  tailTokenBudget: number;
  /** 至少折叠多少 token 才值得调用总结 LLM（默认 400，对齐 Reasonix foldEconomics） */
  minFoldableTokens: number;
  /** 两次压缩的最小间隔（ms，默认 60000） */
  minIntervalMs: number;
  // 注：设计中的 compactTarget 未进入实现
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  compactRatio: 0.7,
  tailTokenBudget: 16_384,
  minFoldableTokens: 400,
  minIntervalMs: 60_000,
};

export interface CompactionResult {
  /** 压缩后的消息数组（ModelMessage[]：head + summary + tail） */
  messages: ModelMessage[];
  compacted: boolean;
  foldedCount: number;
  beforeTokens: number;
  afterTokens: number;
}

export class ContextCompactor {
  constructor(
    config: Partial<CompactionConfig>,
    estimator: TokenEstimator,
    summarizerModel: LanguageModel,   // 即 fastModel
    logger?: Logger,
    archive?: (records: ModelMessage[]) => void,  // 被折叠消息存档（archives/compacted.jsonl）
  );

  /**
   * 直接操作 ai-sdk ModelMessage[]，关键行为：
   * 1. beforeTokens <= windowTokens * compactRatio → 跳过
   * 2. 距上次压缩 < minIntervalMs → 跳过（频率控制）
   * 3. 分区 head | foldable | tail（tail 按 tailTokenBudget 从尾部累计）；
   *    tail 不允许以 tool 消息开头——孤儿 tool 消息会被并回 foldable，
   *    保持 tool-call/tool-result 配对完整
   * 4. foldableTokens < minFoldableTokens → 跳过（经济性判断）
   * 5. summarize(foldable) 成功 → 折叠区整段替换为一条 user 摘要消息
   *    （'[对话摘要 — 已压缩 N 条消息]'），foldable 原文经 archive 存档
   * 6. summarize 失败 → 返回原消息不压缩，由 HistoryTruncator 兜底
   */
  async maybeCompact(messages: ModelMessage[], windowTokens: number): Promise<CompactionResult>;

  /** 每条消息 slimContent 截 2000 字符后拼接，withRetry(2) 调 fastModel，maxOutputTokens: 1000 */
  private async summarize(messages: ModelMessage[]): Promise<string>;
}
```

### 8.3 与 HistoryTruncator 的协同（as-built）

```
AgentLoop.send():

  // Step 0: 旧工具结果 snip（60%，零 LLM 成本，原地修改）
  this.toolResultSnipper.snipStale(this.messages, this.contextWindow);

  // Step 1: 先尝试智能压缩（70%，仅在 compaction.enabled 且有 fastModel 时）
  const compactResult = await this.contextCompactor?.maybeCompact(this.messages, contextWindow);
  if (compactResult?.compacted) {
    this.messages = compactResult.messages;   // head + summary + tail
  }

  // Step 2: 机械截断兜底（80%；压缩未触发或失败都会走到这里）
  const truncResult = this.historyTruncator.truncate(this.messages);
  if (truncResult.truncatedCount > 0) {
    this.messages = [this.messages[0], ...truncResult.messages];  // 返回值不含 head
  }

  // Step 3: ModelRouter 选模型 → generateText
```

---

## 9. P3 — StormBreaker（死循环防护）

### 9.1 设计目标

- 对标 Reasonix §14：检测 "同一个 tool + 同一个 error" 的重复模式
- 触发时注入干预消息

### 9.2 接口

> as-built：与设计一致，细微差异——构造函数 `StormBreaker(maxStorms = 3, logger?)`；干预消息带有连续失败次数、工具名与错误摘要；`normalizeError` 额外处理 Windows 反斜杠路径。

### 9.3 集成点 — AgentLoop.onStepFinish（as-built）

```
AgentLoop.send() — onStepFinish 回调:

  // ⚠️ 关键：generateText 执行期间直接 push 进 this.messages 不会被本次调用感知，
  // 且会被后续的 response.messages 合并覆盖。干预消息先缓冲到 interventions，
  // 待 this.messages.push(...result.response.messages) 合并完成后再按序追加，
  // 确保下一轮调用能看到干预。
  const interventions: ModelMessage[] = [];

  onStepFinish: (event) => {
    // ... 现有逻辑（tool_call / reasoning 通知） ...
    if (event.toolResults) {
      for (const tr of event.toolResults) {
        const isError = !!(tr as any).error;
        if (isError) {
          const { intervene, message } = this.stormBreaker.detect(tr.toolName, (tr as any).error);
          if (intervene && message) {
            interventions.push({ role: 'user', content: message });   // ← 缓冲，不直接 push
          }
        } else {
          this.stormBreaker.reset();
        }
      }
    }
  },

  // generateText 返回后：
  this.messages.push(...result.response.messages);
  if (interventions.length > 0) this.messages.push(...interventions);
```

---

## 10. 完整改造后的 AgentLoop.send() 管道（as-built）

```
┌──────────────────────────────────────────────────────────┐
│              AgentLoop.send(blocks)                       │
├──────────────────────────────────────────────────────────┤
│  1. this.messages.push({ role: 'user', content })         │
│                                                           │
│  2. ToolResultSnipper.snipStale()                         │
│     └── 60% 阈值：旧工具结果截为头+尾，零 LLM 成本，        │
│         原文存档 archives/tool-results.jsonl               │
│                                                           │
│  3. ContextCompactor.maybeCompact()（仅 enabled+fastModel）│
│     └── 70% 阈值：fastModel 摘要折叠中段                   │
│     └── 失败/不划算 → 降级到下一步                         │
│                                                           │
│  4. HistoryTruncator.truncate()                           │
│     └── 80% 阈值：保留 head + tail（tail token 预算）      │
│     └── 丢弃段存档 archives/history-truncated.jsonl        │
│     └── （另有 50% 软警告 onContextUsage，0.5/0.4 滞回）   │
│                                                           │
│  5. ModelRouter.classify() → 选择 fastModel / 主模型       │
│                                                           │
│  6. withRetry(generateText({                              │
│       model: activeModel,                                 │
│       system: this.systemPrompt,    // 缓存友好            │
│       messages: this.messages,      // ModelMessage[]      │
│       tools: this.tools,            // 构造时按名排序       │
│       stopWhen: stepCountIs(maxToolRounds + 1),            │
│       abortSignal, maxRetries: 2,                          │
│       maxOutputTokens / temperature,  // 仅配置存在时传递   │
│       onStepFinish: (event) => {                          │
│         // StormBreaker.detect() → 干预消息先入缓冲         │
│         // tool_call / tool_result / reasoning 通知        │
│         // stepsCompleted++（外层重试门控：===0 才重试）    │
│       },                                                  │
│     }), { maxAttempts: 3, shouldRetry: stepsCompleted===0  │
│           && isRetryableError })                          │
│                                                           │
│  7. TokenEstimator.calibrate(usage, promptChars)           │
│     this.messages.push(...result.response.messages)        │
│       // ⚠️ ai-sdk v7：只含新生成消息，必须追加而非替换     │
│     this.messages.push(...interventions)                   │
│                                                           │
│  8. return { stopReason, content, usage }                  │
└──────────────────────────────────────────────────────────┘
```

---

## 11. 文件清单与改动量估算

### 新建文件（as-built 落地情况）

| 文件 | 行数(估) | 优先级 | 落地 |
|------|---------|--------|------|
| `src/core/TokenEstimator.ts` | ~105 | P0 | ✅ 已建 |
| `src/agents/kernel/HistoryTruncator.ts` | ~210 | P0 | ✅ 已建 |
| `src/agents/kernel/ToolOutputTruncator.ts` | ~106 | P1 | ✅ 已建 |
| `src/agents/kernel/tools/module-context.ts` | ~127 | P1 | ✅ 已建（改为调用时惰性读文件） |
| `src/agents/kernel/ModelRouter.ts` | ~105 | P2 | ✅ 已建 |
| `src/agents/kernel/ContextCompactor.ts` | ~243 | P2 | ✅ 已建 |
| `src/agents/kernel/StormBreaker.ts` | ~86 | P3 | ✅ 已建 |
| ~~`src/agents/prompts/ProgressiveDisclosure.ts`~~ | — | P1 | ❌ 未建（Tier-1 摘要并入 `PromptBuilder.ts`，见 §5.3） |
| `src/agents/kernel/ToolResultSnipper.ts` | ~163 | 方案外 | ✅ 已建（60% snip 层） |
| `src/agents/kernel/ArchiveWriter.ts` | — | 方案外 | ✅ 已建（丢弃内容 jsonl 存档） |

### 修改文件

| 文件 | 改动范围 | 优先级 | 风险 |
|------|---------|--------|------|
| `AgentLoop.ts` | 较大 — 集成所有新模块 | P0-P3 | ⚠️ 高 |
| `AgentKernel.ts` | 小 — 透传新参数 + 注册 module_context 工具 | P1 | 低 |
| `PromptBuilder.ts` | 中 — 分离 system prompt + Tier-1 摘要 | P1 | ⚠️ 中 |
| `ToolAdapter.ts` | 小 — 包装 ToolOutputTruncator | P1 | 低 |
| `types.ts` (kernel) | 小 — 新增类型接口 | P0-P2 | 低 |
| `defaults.ts` + `schema.ts` | 小 — 新增配置字段 | P0 | 低 |
| `ModuleAgentSubsystem.ts` | 小 — 透传 usage / truncation / compaction | P0 | 低 |
| `ProviderResolver.ts` | 小 — 支持双模型 | P2 | 低 |

---

## 12. 风险矩阵

| 风险 | 影响模块 | 缓解措施 |
|------|---------|---------|
| ai-sdk 截断 messages 后 tool_call↔tool_result 配对断裂 | HistoryTruncator | 先做集成测试，必要时只截断在两个 user message 之间 |
| system prompt 单独分离导致某些 Provider 行为变化 | AgentLoop | 保留一个 feature flag，出问题可回退 |
| summarizer LLM 调用延迟阻塞 send() | ContextCompactor | 默认关闭，手动开启；或改为异步 fire-and-forget |
| fastModel 分类错误导致简单问题用了弱模型 | ModelRouter | 第 1 轮始终用 normal model；提供 `forceModel` 覆盖 |
| 渐进披露导致 Agent 不主动读文档 | ProgressiveDisclosure | 在 system prompt 中明确提示 "需要时使用 tool 获取完整文档" |
