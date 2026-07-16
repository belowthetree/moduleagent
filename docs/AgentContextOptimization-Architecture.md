# ModuleAgent 上下文优化 — 架构与模块设计

> 基于 `DeepSeek-Reasonix-Optimization.md` 对标 + 当前架构分析
> 设计日期: 2026-07-16

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

### 1.2 优化切入点总览

```
                    ┌──────────────────────┐
                    │   TokenEstimator     │  P0 新建: 自适应 Token 估算
                    ├──────────────────────┤
                    │   HistoryTruncator   │  P0 新建: 滑动窗口截断
                    ├──────────────────────┤
  AgentLoop ────────┤   ContextCompactor   │  P2 新建: 在线压缩
  (send 管道)       ├──────────────────────┤
                    │   ModelRouter        │  P2 新建: 快/慢模型路由
                    ├──────────────────────┤
                    │   StormBreaker       │  P3 新建: 死循环检测
                    └──────────────────────┘

                    ┌──────────────────────┐
  ToolAdapter ──────┤   ToolOutputTruncator│  P1 新建: 工具输出截断
                    └──────────────────────┘

                    ┌──────────────────────┐
  PromptBuilder ────┤   CacheFriendlyPrompt│  P1 改造: 缓存友好结构
                    ├──────────────────────┤
                    │   ProgressiveDisclose│  P1 改造: 渐进式披露
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

  /** 从 Provider 返回的真实 usage 反推校准 */
  calibrate(usage: TokenUsage, promptText: string): void {
    if (usage.promptTokens <= 0 || promptText.length === 0) return;
    const r = usage.promptTokens / promptText.length;
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
  └→ this.tokenEstimator.calibrate(usage, promptText)
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
// src/agents/kernel/HistoryTruncator.ts

export interface TruncationConfig {
  /** 上下文窗口总 token 数（从 provider 配置获取，默认 128K） */
  contextWindow: number;
  /** 触发截断的阈值比例（默认 0.8） */
  truncateRatio: number;
  /** 截断后保留最近消息的 token 预算（默认 16384，对齐 Reasonix） */
  tailTokenBudget: number;
  /** 最小保留消息数（默认 2，对齐 Reasonix minRecentKeep） */
  minKeepMessages: number;
  /** 截断时注入的占位文本 */
  truncationMarker: string;
}

export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  contextWindow: 128_000,
  truncateRatio: 0.8,
  tailTokenBudget: 16_384,
  minKeepMessages: 2,
  truncationMarker: '[… 较早的对话已被截断以节省上下文 …]\n\n',
};

export interface TruncationResult {
  /** 截断后的消息数组 */
  messages: Array<{ role: string; content: string }>;
  /** 被移除的消息数 */
  truncatedCount: number;
  /** 截断前估算 token 数 */
  beforeTokens: number;
  /** 截断后估算 token 数 */
  afterTokens: number;
}

export class HistoryTruncator {
  private config: TruncationConfig;
  private estimator: TokenEstimator;

  constructor(config: Partial<TruncationConfig> = {}, estimator: TokenEstimator) {
    this.config = { ...DEFAULT_TRUNCATION_CONFIG, ...config };
    this.estimator = estimator;
  }

  /**
   * 截断消息历史。
   *
   * 保留规则 (对齐 Reasonix planCompaction):
   * 1. 始终保留第一条 user message（包含 module context 注入）
   * 2. 从尾部向前累计，直到达到 tailTokenBudget 或 minKeepMessages
   * 3. 被截断的消息合并为一条 truncationMarker 占位消息
   *
   * @param messages 完整消息历史（role + content）
   * @returns 截断结果
   */
  truncate(messages: Array<{ role: string; content: string }>): TruncationResult {
    const totalTokens = this.estimator.estimateMessages(messages);
    const threshold = this.config.contextWindow * this.config.truncateRatio;

    if (totalTokens <= threshold) {
      return { messages, truncatedCount: 0, beforeTokens: totalTokens, afterTokens: totalTokens };
    }

    // ── 分区: 头(第一条) | 中间(可折叠) | 尾(tail budget) ──
    const head = messages[0]!;
    const tail: typeof messages = [];
    let tailTokens = 0;

    // 从尾部倒序遍历
    for (let i = messages.length - 1; i >= 1; i--) {
      const msg = messages[i]!;
      const msgTokens = this.estimator.estimate(msg.content) + 4;
      if (tailTokens + msgTokens <= this.config.tailTokenBudget || tail.length < this.config.minKeepMessages) {
        tail.unshift(msg);
        tailTokens += msgTokens;
      } else {
        break;
      }
    }

    const truncatedCount = messages.length - 1 - tail.length;
    if (truncatedCount <= 0) {
      return { messages, truncatedCount: 0, beforeTokens: totalTokens, afterTokens: totalTokens };
    }

    const marker = { role: 'user' as const, content: this.config.truncationMarker };
    const result = [head, marker, ...tail];
    const afterTokens = this.estimator.estimateMessages(result);

    return { messages: result, truncatedCount, beforeTokens: totalTokens, afterTokens };
  }
}
```

### 3.3 集成点 — AgentLoop.send() 改造

```
当前流程:
  send(blocks) {
    const userText = blocks.map(b => b.text).join('\n');
    this.messages.push({ role: 'user', content: userText });     // ← push
    const result = await generateText({ messages: this.messages }); // ← 全量发送
    this.messages = [...result.response.messages];                 // ← 更新历史
  }

改造后:
  send(blocks) {
    const userText = blocks.map(b => b.text).join('\n');
    this.messages.push({ role: 'user', content: userText });      // ← push
    // ── 新增: 截断检查 ──
    const truncResult = this.historyTruncator.truncate(this.messages);
    if (truncResult.truncatedCount > 0) {
      this.logger.warn(`[AgentLoop] truncated ${truncResult.truncatedCount} msgs, tokens: ${truncResult.beforeTokens}→${truncResult.afterTokens}`);
    }
    // ── 发送截断后的消息 ──
    const result = await generateText({ messages: truncResult.messages });
    // ⚠️ 关键: 用 result.response.messages 替换 this.messages (ai-sdk 返回完整历史)
    this.messages = [...result.response.messages];
    // ── 新增: token 校准 ──
    if (result.usage) {
      this.tokenEstimator.calibrate(result.usage, userText);
    }
  }
```

### 3.4 ⚠️ 关键注意事项

1. **ai-sdk 的 `result.response.messages`** 会自动管理 messages 数组（包含 tool_call/tool_result），**截断后的 messages 传给 generateText 后，返回的 response.messages 是 LLM 视角的完整历史**。直接用 `result.response.messages` 覆盖 `this.messages` 即可保持后续轮次正确。

2. **第一条 user message 必须保留**：它承载了 `buildPromptBlocks` 注入的全部 module context。若截断它，后续轮次丢失模块上下文。

3. **截断后 ai-sdk 可能报错**：因为 tool_call 和 tool_result 的配对关系被打破。需测试：当截断边界恰好切断 tool_call↔tool_result 配对时，ai-sdk 的行为。

---

## 4. P1 — CacheFriendlyPrompt（缓存友好的 Prompt 结构）

### 4.1 设计目标

- 让 Provider 的 **prompt prefix cache** 能最大化命中
- 核心原则：**system prompt 在整个 session 中永不改变，放在请求最前面**
- 对标 Reasonix：PrefixShape / CacheShape 追踪

### 4.2 关键认知

当前架构的问题：
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

```
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

### 4.4 工具 Schema 排序（补充）

```typescript
// AgentLoop.constructor() 中:
this.tools = convertToolsToAISDK(config.tools);  // ← 当前

// 改为:
const sortedTools = [...config.tools].sort((a, b) => a.name.localeCompare(b.name));
this.tools = convertToolsToAISDK(sortedTools);   // ← 排序后 JSON 稳定
```

### 4.5 Cache 诊断日志

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

### 5.3 接口设计

```typescript
// src/agents/prompts/ProgressiveDisclosure.ts

export interface DisclosureTiers {
  tier0: string;   // system prompt 全文
  tier1: string;   // 首条消息摘要
  tier2: {         // 按需工具定义
    moduleContext: string;     // module.md 全文
    patterns: string;          // patterns.md 全文
    experience: string;        // experience.md 全文
  };
}

export function buildDisclosureTiers(options: {
  moduleName: string;
  graph: ModuleGraph;
  configDir: string;
}): DisclosureTiers {
  const node = options.graph.nodes.get(options.moduleName);
  const body = node?.definition?.body || '';
  const summary = body.length > 2000
    ? body.slice(0, 2000) + '\n\n... (使用 module_context_read_full 获取完整文档)'
    : body;

  return {
    tier0: loadSystemPrompt(options.configDir, options.moduleName, options.graph.root),
    tier1: [
      `# Module: ${options.moduleName}`,
      '',
      summary,
      '',
      '---',
      '可用工具:',
      '- `module_context_read_full` — 获取完整模块文档',
      '- `module_context_read_patterns` — 获取修改规范',
      '- `module_context_read_experience` — 获取近期经验',
    ].join('\n'),
    tier2: {
      moduleContext: body,
      patterns: loadPatternsContent(node?.absolutePath),
      experience: loadExperienceContent(node?.absolutePath, 3),
    },
  };
}
```

### 5.4 MCP 工具注册

```typescript
// src/agents/kernel/tools/module-context.ts (新建)

import type { Tool } from '../types.js';
import type { DisclosureTiers } from '../../prompts/ProgressiveDisclosure.js';

export function createModuleContextTools(tiers: DisclosureTiers): Tool[] {
  return [
    {
      name: 'module_context_read_full',
      description: '获取当前模块的完整文档（module.md）。当需要了解模块的完整 API、依赖、职责时调用。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      async execute() {
        return { content: tiers.moduleContext || '(无模块文档)' };
      },
    },
    {
      name: 'module_context_read_patterns',
      description: '获取当前模块的修改规范（patterns.md），包含联动修改规律。',
      inputSchema: { type: 'object', properties: {}, required: [] },
      async execute() {
        return { content: tiers.patterns || '(无修改规范)' };
      },
    },
    {
      name: 'module_context_read_experience',
      description: '获取当前模块的近期开发经验（experience.md），包含踩坑记录和决策理由。',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '获取最近 N 条经验，默认 3' },
        },
        required: [],
      },
      async execute(input) {
        const count = (input as any).count || 3;
        const sections = tiers.experience.split(/\n(?=## )/);
        const entries = sections.filter(s => s.trim().startsWith('## '));
        const recent = entries.slice(-count);
        return { content: recent.join('\n') || '(无近期经验)' };
      },
    },
  ];
}
```

### 5.5 集成点 — AgentKernel 改造

```
// AgentKernel.constructor() — 工具注册阶段:

// 当前:
this.registry = createKernelToolRegistry(sandbox, crossModuleRouter, requestingModule);

// 改造后:
const disclosureTiers = buildDisclosureTiers({ moduleName, graph, configDir });
this.registry = createKernelToolRegistry(sandbox, crossModuleRouter, requestingModule);
// 额外注册 3 个 module_context:* 工具
this.registry.registerAll(createModuleContextTools(disclosureTiers));
```

---

## 6. P1 — ToolOutputTruncator（工具输出截断）

### 6.1 设计目标

- 包装每个 Tool 的 execute()，限制输出大小
- 对标 Reasonix：`maxToolOutputBytes = 32KB` + §9.2 Stale Tool Result snip

### 6.2 接口

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

AgentLoop.send() — 选择模型:
  const routeCtx: RouteContext = {
    userText,
    hasFileReferences: /[@\.\/\\]/.test(userText) || /\.(go|js|ts|py|rs|java)/.test(userText),
    hasCodeActions: /fix|修复|create|创建|write|写|edit|修改|delete|删除/.test(userText),
    messageLength: userText.length,
    turnNumber: this.messages.filter(m => m.role === 'user').length,
  };
  const route = this.modelRouter.classify(routeCtx);
  const activeModel = route === 'fast' && this.fastModel ? this.fastModel.model : this.model;

  const result = await generateText({
    model: activeModel,  // ← 动态选择
    ...
  });
```

---

## 8. P2 — ContextCompactor（在线上下文压缩）

### 8.1 设计目标

- 对标 Reasonix §1 分层压缩：`maybeCompact()` → `planCompaction()` → `summarize()`
- **异步执行**：不阻塞 Agent 主循环
- **降级安全**：总结失败时回退到 HistoryTruncator 的机械截断
- 必须与 HistoryTruncator 协同：compactor 在截断之前先尝试"智能压缩"

### 8.2 接口

```typescript
// src/agents/kernel/ContextCompactor.ts

export interface CompactionConfig {
  /** 触发压缩的 token 阈值比例 */
  compactRatio: number;         // 默认 0.7
  /** 压缩后的目标 token 比例 */
  compactTarget: number;        // 默认 0.4
  /** 保留原文的尾部 token 预算 */
  tailTokenBudget: number;      // 默认 16384
  /** 至少折叠多少 token 才值得调用总结 LLM */
  minFoldableTokens: number;    // 默认 400
  /** 两次压缩的最小间隔 (ms) */
  minIntervalMs: number;        // 默认 60000
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  compactRatio: 0.7,
  compactTarget: 0.4,
  tailTokenBudget: 16384,
  minFoldableTokens: 400,
  minIntervalMs: 60000,
};

export interface CompactionResult {
  /** 压缩后的消息数组 */
  messages: Array<{ role: string; content: string }>;
  /** 是否执行了压缩 */
  compacted: boolean;
  /** 被折叠的消息数 */
  foldedCount: number;
  /** 压缩前后 token 数 */
  beforeTokens: number;
  afterTokens: number;
}

export class ContextCompactor {
  private config: CompactionConfig;
  private estimator: TokenEstimator;
  private summarizerModel: LanguageModel;
  private lastCompactionTime = 0;

  constructor(config: Partial<CompactionConfig>, estimator: TokenEstimator, summarizerModel: LanguageModel) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.estimator = estimator;
    this.summarizerModel = summarizerModel;
  }

  /**
   * 检查是否需要压缩，如果需要则执行。
   * 若经济性不划算（foldable < minFoldableTokens）则跳过。
   */
  async maybeCompact(
    messages: Array<{ role: string; content: string }>,
    windowTokens: number,
  ): Promise<CompactionResult> {
    const beforeTokens = this.estimator.estimateMessages(messages);
    const threshold = windowTokens * this.config.compactRatio;
    if (beforeTokens <= threshold) {
      return { messages, compacted: false, foldedCount: 0, beforeTokens, afterTokens: beforeTokens };
    }

    const now = Date.now();
    if (now - this.lastCompactionTime < this.config.minIntervalMs) {
      return { messages, compacted: false, foldedCount: 0, beforeTokens, afterTokens: beforeTokens };
    }

    // 分区
    const head = messages[0]!;
    const tail: typeof messages = [];
    let tailTokens = 0;
    for (let i = messages.length - 1; i >= 1; i--) {
      const msg = messages[i]!;
      const t = this.estimator.estimate(msg.content) + 4;
      if (tailTokens + t <= this.config.tailTokenBudget) { tail.unshift(msg); tailTokens += t; }
      else break;
    }

    const foldable = messages.slice(1, messages.length - tail.length);
    const foldableTokens = beforeTokens - tailTokens - this.estimator.estimate(head.content);
    if (foldableTokens < this.config.minFoldableTokens) {
      return { messages, compacted: false, foldedCount: 0, beforeTokens, afterTokens: beforeTokens };
    }

    // 调用 summarizer LLM 生成摘要
    try {
      const summary = await this.summarize(foldable);
      this.lastCompactionTime = now;
      const summaryMsg = { role: 'user', content: `[对话摘要]\n\n${summary}` };
      const result = [head, summaryMsg, ...tail];
      const afterTokens = this.estimator.estimateMessages(result);
      return { messages: result, compacted: true, foldedCount: foldable.length, beforeTokens, afterTokens };
    } catch (err) {
      // 回退: 不压缩，让 HistoryTruncator 机械截断
      return { messages, compacted: false, foldedCount: 0, beforeTokens, afterTokens: beforeTokens };
    }
  }

  /**
   * 调用轻量模型生成对话摘要
   */
  private async summarize(messages: Array<{ role: string; content: string }>): Promise<string> {
    const conversation = messages
      .map(m => `[${m.role}]: ${m.content.slice(0, 2000)}`)
      .join('\n\n');

    const result = await generateText({
      model: this.summarizerModel,
      system: '你是一个对话摘要器。将以下 Agent 对话压缩为简洁摘要，保留关键决策、文件修改、错误和解决方案。',
      prompt: `请摘要以下对话（保留关键信息）：\n\n${conversation}`,
      maxTokens: 1000,
    });

    return result.text || '(摘要生成失败)';
  }
}
```

### 8.3 与 HistoryTruncator 的协同

```
AgentLoop.send():

  // Step 1: 先尝试智能压缩
  const compactResult = await this.compactor.maybeCompact(this.messages, contextWindow);
  if (compactResult.compacted) {
    this.messages = compactResult.messages;
    logger.info(`[AgentLoop] compacted ${compactResult.foldedCount} msgs, tokens: ${compactResult.beforeTokens}→${compactResult.afterTokens}`);
  } else {
    // Step 2: 压缩不成功 → 机械截断
    const truncResult = this.historyTruncator.truncate(this.messages);
    if (truncResult.truncatedCount > 0) {
      this.messages = truncResult.messages;
      logger.warn(`[AgentLoop] truncated ${truncResult.truncatedCount} msgs`);
    }
  }

  // Step 3: 发送
  const result = await generateText({ messages: this.messages, ... });
```

---

## 9. P3 — StormBreaker（死循环防护）

### 9.1 设计目标

- 对标 Reasonix §14：检测 "同一个 tool + 同一个 error" 的重复模式
- 触发时注入干预消息

### 9.2 接口

```typescript
// src/agents/kernel/StormBreaker.ts

export class StormBreaker {
  private stormSig = '';
  private stormCount = 0;
  private readonly maxStorms = 3;
  private readonly interventionMessage = 
    '[系统提示] 你似乎陷入了循环——连续多次相同操作失败。请尝试不同的方法或向用户寻求帮助。';

  /** 检测并返回是否应干预 */
  detect(toolName: string, error: string): { intervene: boolean; message?: string } {
    const sig = `${toolName}:${this.normalizeError(error)}`;
    if (sig === this.stormSig) {
      this.stormCount++;
      if (this.stormCount >= this.maxStorms) {
        return { intervene: true, message: this.interventionMessage };
      }
    } else {
      this.stormSig = sig;
      this.stormCount = 1;
    }
    return { intervene: false };
  }

  /** 任何成功操作复位计数器 */
  reset(): void {
    this.stormSig = '';
    this.stormCount = 0;
  }

  private normalizeError(error: string): string {
    // 去参数化：移除路径、数字、UUID 等变化部分
    return error
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\/[^\s]+\/[^\s]+/g, '<PATH>')
      .replace(/\d+/g, '<N>');
  }
}
```

### 9.3 集成点 — AgentLoop.onStepFinish

```
AgentLoop.send() — onStepFinish 回调:

  onStepFinish: (event) => {
    // ... 现有逻辑 ...
    if (event.toolResults) {
      for (const tr of event.toolResults) {
        const isError = !!(tr as any).error;
        if (isError) {
          const { intervene, message } = this.stormBreaker.detect(tr.toolName, (tr as any).error);
          if (intervene && message) {
            // 注入干预消息到 messages
            this.messages.push({ role: 'user', content: message });
            logger.warn(`[StormBreaker] intervened after ${this.stormBreaker.maxStorms} repeated failures`);
          }
        } else {
          this.stormBreaker.reset();
        }
      }
    }
  },
```

---

## 10. 完整改造后的 AgentLoop.send() 管道

```
┌──────────────────────────────────────────────────────────┐
│              AgentLoop.send(blocks)                       │
├──────────────────────────────────────────────────────────┤
│  1. pushUserMessage(userText)                             │
│     └── this.messages.push({ role: 'user', content })     │
│                                                           │
│  2. 【新】ModelRouter.classify()                          │
│     └── 选择 fastModel / normalModel                      │
│                                                           │
│  3. 【新】ContextCompactor.maybeCompact()                  │
│     └── 智能压缩：调用 summarizer LLM                     │
│     └── 降级：↓                                           │
│                                                           │
│  4. 【新】HistoryTruncator.truncate()                      │
│     └── 机械截断：保留 head + tail                        │
│                                                           │
│  5. generateText({                                        │
│       model: activeModel,                                 │
│       system: this.systemPrompt,    // 【改】缓存友好      │
│       messages: this.messages,                            │
│       tools: this.tools,            // 【改】排序稳定      │
│       stopWhen: stepCountIs(...),                         │
│       onStepFinish: (event) => {                          │
│         // 【新】StormBreaker.detect()                    │
│         // 【不改】现有 tool_call / reasoning 通知        │
│       },                                                  │
│     })                                                    │
│                                                           │
│  6. 【新】TokenEstimator.calibrate(usage, promptText)      │
│     └── this.messages = result.response.messages          │
│                                                           │
│  7. return { stopReason, content, usage }                  │
└──────────────────────────────────────────────────────────┘
```

---

## 11. 文件清单与改动量估算

### 新建文件

| 文件 | 行数(估) | 优先级 | 依赖 |
|------|---------|--------|------|
| `src/core/TokenEstimator.ts` | ~80 | P0 | 无 |
| `src/agents/kernel/HistoryTruncator.ts` | ~100 | P0 | TokenEstimator |
| `src/agents/kernel/ToolOutputTruncator.ts` | ~90 | P1 | Tool 类型 |
| `src/agents/kernel/tools/module-context.ts` | ~70 | P1 | Sandbox |
| `src/agents/kernel/ModelRouter.ts` | ~80 | P2 | 无 |
| `src/agents/kernel/ContextCompactor.ts` | ~150 | P2 | TokenEstimator, ai-sdk |
| `src/agents/kernel/StormBreaker.ts` | ~60 | P3 | 无 |

### 修改文件

| 文件 | 改动范围 | 优先级 | 风险 |
|------|---------|--------|------|
| `AgentLoop.ts` | 较大 — 集成所有新模块 | P0-P3 | ⚠️ 高 |
| `AgentKernel.ts` | 小 — 透传新参数 | P1 | 低 |
| `PromptBuilder.ts` | 中 — 分离 system prompt + 分层注入 | P1 | ⚠️ 中 |
| `ToolAdapter.ts` | 小 — 包装 ToolOutputTruncator | P1 | 低 |
| `types.ts` (kernel) | 小 — 新增类型接口 | P0-P2 | 低 |
| `defaults.ts` + `schema.ts` | 小 — 新增配置字段 | P0 | 低 |
| `ModuleAgentSubsystem.ts` | 小 — 透传 usage | P0 | 低 |
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
