# DeepSeek-Reasonix Agent 优化机制详解

> 基于 E:\Project\DeepSeek-Reasonix (v1.0.0+) 源码分析
> 分析日期: 2026-07-16

---

## 目录

1. [上下文窗口管理与自动压缩](#1-上下文窗口管理)
2. [Provider 前缀缓存优化](#2-provider-前缀缓存)
3. [Memory v5 执行编译器](#3-memory-v5-执行编译器)
4. [Token 经济模式](#4-token-经济模式)
5. [MCP 插件懒加载与缓存](#5-mcp-插件懒加载与缓存)
6. [双模型协调器 (Two-Model Coordinator)](#6-双模型协调器)
7. [请求重试与容错](#7-请求重试与容错)
8. [任务分类与路由](#8-任务分类与路由)
9. [工具执行优化](#9-工具执行优化)
10. [Checkpoint 快照与 Rewind 机制](#10-checkpoint-快照与-rewind-机制)
11. [Subagent 隔离与深度控制](#11-subagent-隔离与深度控制)
12. [图像压缩](#12-图像压缩)
13. [网络层优化](#13-网络层优化)
14. [死循环防护机制](#14-死循环防护机制)
15. [配置参数汇总](#15-配置参数汇总)

---

## 1. 上下文窗口管理

### 1.1 分层压缩策略 (Tiered Compaction)

Reasonix 的核心创新之一是多层级的上下文压缩策略，在完全不破坏 Provider 前缀缓存的前提下，渐进式地管理上下文窗口。

```
文件: internal/agent/compact.go
```

#### 四个关键阈值 (递增触发)

| 阈值 | 默认比例 | 行为 |
|------|----------|------|
| `softCompactRatio` | 50% | 仅发出通知，告知用户上下文正在增长 |
| `toolResultSnipRatio` | 60% | 执行 cheap snip：截断旧的工具输出（保留头尾行），不调用 LLM |
| `compactRatio` | 80% | 自动触发完整压缩 —— 调用 summarizer LLM 生成摘要 |
| `compactForceRatio` | 90% | 强制执行压缩，即使 fold economics 判断不值 |

```go
// internal/agent/compact.go:24-36
const (
    defaultSoftCompactRatio    = 0.5   // 上下文达到窗口50%时通知
    defaultToolResultSnipRatio = 0.6   // 60%时截断stale tool结果
    defaultCompactRatio        = 0.8   // 80%触发完整压缩
    defaultCompactForceRatio   = 0.9   // 90%强制执行压缩
    defaultCompactTarget       = 0.5   // 压缩后tail不超过窗口的50%
    defaultTailTokens          = 16384 // verbatim最近tail的token预算
    minRecentKeep              = 2     // 永远保留至少2条最近消息
    minCompactMessages         = 2     // 少于2条可压缩消息时跳过
)
```

#### 压缩流程 (compact)

```
maybeCompact() 
  → 80%阈值? → PruneStaleToolResults() (免费清理)
  → force或清理后仍超阈值? → compact()
    → planCompaction() 确定保留区域
    → partitionFold() 划分保留/折叠分区
    → foldEconomics() 经济性判断 (≥400 tokens才值得)
    → summarizeWithRetry() 调用LLM生成摘要
    → 失败则 mechanicalFoldDigest() 机械折叠
```

**关键设计**：
- **前缀保持不动**：系统提示词、第一个用户 turn（包含所有 `REASONIX.md` 上下文）、和之前的摘要永远不被压缩
- **尾部 token-budget**：保留最近内容时不按消息数量，而是按 token 预算（16384 tokens），防止几条巨大的工具输出撑爆窗口
- **累积式摘要**：摘要作为 user message 插入，后续压缩不会再次压缩之前的摘要（防信息漂移）
- **用户 turn 保护**：所有用户消息保持 verbatim，只折叠 assistant/tool 消息
- **存档**：丢弃的原始消息写入 `.jsonl` 存档文件

#### 免费维护：Stale Tool Result 处理

```
文件: internal/agent/prune.go
```

在触发完整压缩之前，有两层几乎零成本的工具结果维护：

1. **SnipStaleToolResults** (在 60% 阈值触发)：截断旧工具输出，保留头尾行
   - 只读工具：保留前 80 行 + 后 12 行
   - 有副作用工具 (bash等)：保留前 40 行 + 后 40 行

2. **PruneStaleToolResults** (在 80% 阈值触发)：完全剔除旧工具输出内容，代之以指向存档的引用

这里的智能之处在于**按工具类型分策略** —— `snipStrategyFor()` 查询工具是否实现了 `SnipHinter` 接口，不同工具可以自定义裁剪策略。

### 1.2 Token 估算

```
文件: internal/agent/compact.go:153-189
```

Reasonix 不依赖外部 tokenizer，而是使用**运行时校准**的自适应 token 估算：

```go
func (a *Agent) tokPerChar() float64 {
    if u := a.lastUsage.Load(); u != nil && u.PromptTokens > 0 {
        if c := charsOfMessages(a.session.Messages); c > 0 {
            if r := float64(u.PromptTokens) / float64(c); r > 0.05 && r < 2 {
                return r  // 从真实使用量反推的tokens-per-char比例
            }
        }
    }
    return fallbackTokPerChar // 0.25 (≈4 chars/token)
}
```

从 Provider 返回的真实 prompt_tokens 反算出字符→token 的转换比，在首次 API 调用后校准，之后所有压缩决策都用这个校准值。

---

## 2. Provider 前缀缓存

### 2.1 Cache Shape 追踪

```
文件: internal/agent/cache_shape.go
```

Reasonix 对整个请求前缀做 SHA256 哈希，追踪哪些部分变化导致缓存失效：

```go
type PrefixShape struct {
    SystemHash        string  // 系统提示词hash
    ToolsHash         string  // 工具schema hash (排序后)  
    PrefixHash        string  // system+tools联合hash
    LogRewriteVersion int     // 会话重写版本号
    ToolSchemaTokens  int     // 工具schema token量估算
}
```

每轮 API 调用后，`CompareShape()` 对比前后两次的前缀变化，诊断缓存 miss 的根因：

- **system**: 系统提示词变了
- **tools**: 工具集合变了
- **log_rewrite**: session 被 compact/prune 重写了

这个诊断信息通过 `event.CacheDiagnostics` 事件传递给前端，让用户看到为什么缓存被命中或未命中。

### 2.2 缓存友好设计原则

整个代码库贯彻"缓存稳定"的设计原则：

**Plan Mode** (`agent.go:268`): 切换 Plan Mode 时系统提示词和工具 schema 完全不变，只在 execute 时做 per-call 门控：
```go
// planMode, when true, refuses any tool call whose ReadOnly() is false.
// The system prompt and tool list never change with the toggle so the
// prompt-cache prefix stays valid
planMode atomic.Bool
```

**工具注册表不变**: MCP 插件缓存命中时，占位工具的 names/descriptions/schemas 在整个 session 生命周期内不变 —— 实时握手结果只影响下一 session。这确保了工具 schema 的字节级稳定性，不会因实时变化而让缓存失效（缓存失效=10倍定价）。

```go
// internal/plugin/lazy.go:162-172
// Cache-hit placeholders do NOT touch the registry. The lazyTools already
// carry the cached names/descriptions/schemas the model has seen since boot,
// and Execute forwards to the real tool once ready — swapping in the live
// tools would rewrite the request's tools array mid-session ... invalidating
// the provider prefix cache at 10x miss pricing.
```

**Session Aggregate Cache** (`agent.go:249-256`): 维护跨轮次的累计缓存命中/未命中 token 计数：
```go
sessCacheHit  atomic.Int64  // 累计缓存命中 tokens
sessCacheMiss atomic.Int64  // 累计缓存未命中 tokens
```
这个累计数据在 compaction 后不会被清空（compaction 只重写 session.Messages），因此前端可以展示整个会话的聚合命中率而非单轮抖动。

**环境探测的快照一致性**: 系统提示词中的环境信息（shell、OS、工具列表等）在启动时生成快照，整个会话不刷新 —— 与 MCP 缓存占位符的设计对称。

### 2.3 DeepSeek 特化

```
文件: internal/provider/openai/openai.go
```

DeepSeek 的思考协议通过 `thinking.type=enabled` + `reasoning_effort` 深度提示实现：

- `reasoning_effort`: 默认为 `high`，支持 `high`/`max`/`disabled`
- `thinking.type=disabled`: DeepSeek 也可禁用思考
- `thinking.type` 对 MiniMax/LongCat/Zhipu 采用不同协议适配

多 Provider 后端自动检测（基于 base URL），也支持显式 `reasoning_protocol` 配置覆盖。

---

## 3. Memory v5 执行编译器

```
文件: internal/memorycompiler/
      ├── candidates.go    (候选噪声模式识别)
      ├── compression.go   (多图压缩报告, 1638行)
      ├── feedback.go      (反馈回路)
      └── runtime.go       (运行时执行跟踪)
```

Memory v5 是 Reasonix 的"执行编译器"（Execution Compiler）—— 它在后台记录每轮任务的执行轨迹，并在识别到重复的失败模式后，将执行经验编译为可复用的执行合约。

### 3.1 编译器注入控制

```
文件: internal/agent/agent.go:42-43
```

```go
const memoryCompilerInjectionMax = 5        // 每会话最多注入5次
const memoryCompilerInjectionCooldown = 30秒 // 注入冷却时间
```

通过 `tryMarkMemoryCompilerInjected()` 控制注入频率 —— 一个 cooldown + 最大次数限制，确保编译器不会主导对话。

### 3.2 两种模式

```go
MemoryCompilerVerbosityObserve = "observe"  // 默认：仅记录轨迹，不注入提示词
MemoryCompilerVerbosityCompact = "compact"  // 旧行为：在user turn中注入执行合约
```

`observe` 模式是更新后的默认值 —— 编译器始终写入执行轨迹，但不向模型可见的对话中注入合约。

### 3.3 多维度压缩

压缩涉及多个维度（`compression.go`）：

| 维度 | 限制 |
|------|------|
| `maxCompressedCausalAnchors` | 最大因果锚点 12 个 |
| `maxCompressionReports` | 最大压缩报告 30 个 |
| `maxMemoryGraphNodes` | 最大内存图节点 300 个 |
| `maxMemoryGraphEdges` | 最大内存图边 600 个 |
| `maxCompressionStrings` | 最大压缩字符串 10 个 |
| `maxGraphCouplingStrength` | 图耦合强度上限 0.75 |
| `maxLongTailCausalAnchors` | 长尾因果锚点 3 个 |

### 3.4 反馈修正

当用户在任务完成后立刻说"不对，还有bug"，Memory v5 会反向修正上一个 turn 的成功记录：

```go
// agent.go:546-563
func (a *Agent) reviseMemoryCompilerOutcomeForFeedback(...) {
    if !memorycompiler.IsCorrectiveFeedback(input) { return }
    rt.ReviseOutcomeFromFeedback(*ref, input)
}
```

---

## 4. Token 经济模式

```
文件: internal/boot/token_profile.go
```

### 4.1 两种模式

| 模式 | 行为 |
|------|------|
| `full` (默认) | 加载所有工具源 |
| `economy` | 仅加载核心内置工具, 其他工具源通过 `connect_tool_source` 按需连接 |

### 4.2 核心内置工具集 (Economy Mode)

```go
var tokenEconomyCoreBuiltins = []string{
    "bash", "bash_output", "code_index", "complete_step",
    "edit_file", "glob", "grep", "kill_shell", "ls",
    "move_file", "multi_edit", "read_file", "todo_write",
    "wait", "write_file",
}
```

### 4.3 按需连接 (`connect_tool_source`)

在 Economy 模式下，提供了一个特殊的元工具 `connect_tool_source`，让模型在真正需要时才按需启用工具源：

| 源名称 | 提供的能力 |
|--------|-----------|
| `skills` | Skill 系统 |
| `read_only_skill` | 只读 skill |
| `mcp` | MCP 服务器工具 |
| `lsp` | 语言服务器协议 |
| `web_fetch` | 网页抓取 |
| `install_source` | 安装来源 |
| `task` | 子代理委托 |
| `read_only_task` | 只读子代理 |

**关键优化**: Economy 模式下，工具 schema 更小 → Provider 前缀缓存的 tool schema 部分更小 → 每次请求消耗的 prompt tokens 更少。

---

## 5. MCP 插件懒加载与缓存

```
文件: internal/plugin/lazy.go (420行)
      internal/plugin/cache.go (245行)
```

### 5.1 架构缓存 (Schema Cache)

MCP 服务器握手结果（initialize + listTools + listPrompts/listResources）被持久化到磁盘缓存：

```go
type CachedSchema struct {
    Version       int             `json:"version"`        // schema格式版本
    SpecHash      string          `json:"spec_hash"`      // 规格指纹
    Capabilities  map[string]bool `json:"capabilities"`   // 能力位图
    Tools         []CachedTool    `json:"tools"`          // 缓存工具定义
    LastValidated time.Time       `json:"last_validated"` // 最后验证时间
}
```

**指纹 (SpecFingerprint)**: 对 `command`、`url`、`args`、`env`、`headers` 等承载字段做确定性 SHA256 哈希。env map 的 key 排序保证不同启动间指纹一致。

**版本控制**: `cacheVersion = 1`，schema 格式变化时递增。

### 5.2 懒加载状态机

```
idle → inFlight → ready
idle → inFlight → failed
```

- **Cache Hit** 占位工具：注册时携带完整缓存的 name/description/schema
  - 启动时立即 kick 后台握手
  - 模型调用时：如果后台已就绪 (spawnReady)，直接转发
  - 如果还在进行中 (spawnInFlight)，提示"请下一轮重试"
  - 如果空闲 (spawnIdle)，同步等待握手（带超时）
  - **占位工具名称在整个 session 中不变** —— 不解注册/重新注册 → 保护 Provider 缓存

- **Cache Miss** 占位工具：仅注册一个 `mcp__<server>__connect` 存根
  - 启动时 kick 后台握手
  - 握手完成后，移除存根并注册真实工具（一次性 tool schema 变更）

### 5.3 并发控制

- `lazySpawn.mu` 确保即使多个 tool 同时 Execute，也只发起一次握手
- `ErrSpawningInFlight` 处理多 tab 并发启动同一 MCP 服务器的场景
- `IsServerAlreadyConnected` 检查共享 Host 上是否已有其他 Controller 启动了该服务器

---

## 6. 双模型协调器

```
文件: internal/agent/coordinator.go (916行)
```

### 6.1 核心设计

Coordinator 使用**两个独立的 Session 和 Provider**，分别运行 Planner 和 Executor：

```go
type Coordinator struct {
    planner        provider.Provider   // 规划模型 (通常是更便宜/更快的模型)
    plannerSess    *Session            // 独立的planner会话
    plannerAgent   *Agent              // 可选的工具化planner
    executor       *Agent              // 执行模型 (完整的工具集)
}
```

**关键优化**: 两个模型的 Session 完全隔离，各自的 prompt 前缀互相不影响 —— Planner 的前缀缓存不受 Executor 的对话膨胀影响，Executior 的前缀缓存也不受 Planner 的规划回合影响。

### 6.2 自动跳过 Planner

```go
shouldPlan func(context.Context, string) bool
```

对于无需规划的输入（问候、简单问题、确认），直接跳过规划阶段进入 Executor，节省一次 Planner API 调用。

### 6.3 Planner 失败降级

Planner 出错时自动降级为单模型运行（仅 Executor），保证 turn 不会因为 Planner 临时不可用而失败：

```go
// coordinator.go:294-311
// 错误处理：ctx 取消或 max_steps 暂停是控制流，不是planner失败
// planner 失败时降级到 executor-only，不丢失turn
```

### 6.4 规划写回和事务回滚

Planner session 保持 prepend-only（便于缓存友好），但在失败时进行事务性回滚：

```go
// plan() 中:
before := c.plannerSess.Snapshot()
// ... stream ...
if err != nil {
    c.plannerSess.Replace(before)  // 回滚到调用前状态
}
```

---

## 7. 请求重试与容错

```
文件: internal/provider/retry.go (212行)
```

### 7.1 重试策略

```go
const MaxRetries = 10           // 最多10次重试
const maxBackoff = 15 * time.Second
const maxAuthRetries = 2        // 认证失败最多重试2次
```

**指数退避 + 抖动**:
```go
func backoffDelay(attempt int, retryAfter time.Duration) time.Duration {
    d := time.Duration(1<<(attempt-1)) * 500 * time.Millisecond
    if d > maxBackoff { d = maxBackoff }
    return d + time.Duration(rand.Intn(250))*time.Millisecond
}
```

支持 `Retry-After` 响应头（秒级），优先使用服务器指定的重试间隔。

### 7.2 可重试错误分类

- **连接级错误**: 对 `ECONNRESET`、`ECONNABORTED`、`io.ErrUnexpectedEOF`、`io.EOF`、`net.ErrClosed` 等连接中断重试
- 代理空闲关闭: 检测代理 (v2rayN/sing-box) 在 reasoned 的首次 token 间隙中空闲关闭长时间 SSE 连接
- **HTTP 状态码**: `408`（超时）、`429`（速率限制）、`5xx`（服务器错误）可重试
- **认证 401**: 之前验证过的 key 遇到 401 时重试（MiMo 等高负载网关可能返回瞬时 401）

### 7.3 协议无关

`SendWithRetry` 只覆盖连接+Header 阶段 —— 一旦 body 开始 streaming（模型已开始生成 token），不会重试。这避免了重复消费已生成的 token。

---

## 8. 任务分类与路由

### 8.1 LLM 分类器

```
文件: internal/agent/task_classifier.go (337行)
```

在 `UseMemoryCompilerLLMClassification = true` 时使用 LLM 进行分类：

- **超时**: 2 秒，超时自动 fallback 到启发式分类器
- **缓存**: LRU 内存缓存 (最大 100 条，TTL 5 分钟)
  - Key: 规范化的输入 SHA256 哈希
  - LRU 淘汰: 缓存满时清除最旧的 20%
- **温度**: 0（确定性分类）
- **MaxTokens**: 仅 10（只返回 "task" 或 "chat"）

### 8.2 启发式分类器

默认分类器（无需 API 调用）：

1. **短问候语白名单** (≤3词): hello, hi, thanks, ok 等 → chat
2. **礼貌回应检测**: "thanks for", "thank you for" → chat
3. **文件引用检测** (强任务信号): `@`, `.go`, `.js`, `.py` → task
4. **失败/帮助描述**: "not working", "error", "bug", "broken" → task
5. **动作关键词**: fix, create, write, edit, run, test, 修复, 创建, 修改 等 → task
6. **默认规则**: >5 词 → task，≤5 词 → chat

### 8.3 Auto-Plan 分类器

```
文件: internal/control/auto_plan_classifier.go (95行)
```

决定用户请求是否应先进入 Plan Mode 的分类型 LLM 调用：

- **Temperature**: 0
- **MaxTokens**: 80
- **输出**: `{"needs_plan": true/false, "reason": "..."}`
- **用途**: true → 先做只读研究再写代码；false → 直接执行

---

## 9. 工具执行优化

### 9.1 工具输出截断

```go
// internal/agent/agent.go:36
const maxToolOutputBytes = 32 * 1024  // ~8K tokens
```

单个工具输出在进入模型上下文前被截断到 32KB —— 足够读出整个文件或忙碌的 grep 输出，同时防止意外的 5MB 日志炸毁窗口。

### 9.2 Stale Tool Result 维护

```
文件: internal/agent/prune.go (289行)
```

两层（免费）的过期工具结果维护，**不需要调用 LLM**：

**Snip（截断）**：保留结果的头尾部分
- 只读工具：前 80 行/10000 字符 + 后 12 行/2000 字符
- 有副作用的工具（bash）：前 40 行/8000 字符 + 后 40 行/8000 字符

**Prune（剔除）**：完全移除结果内容，只保留占位符和存档引用

两种操作都：
- 先存档原始内容
- 保留 tool_call/result 配对完整性
- 保留 assistant 包含的 reasoning
- 尊重 KeepPolicy (KeepErrors/KeepUserMarked)

### 9.3 Subagent 工具过滤

```
文件: internal/agent/task.go:87-110
```

子代理的工具集被严格控制：

**永远隐藏**:
- `parallel_tasks`（防止递归爆炸）
- `install_skill`
- `install_source`

**递归委托工具**: 到达最大深度时隐藏
- `task`, `read_only_task`, `run_skill`, `read_only_skill`, `explore`, `research`, `review`, `security_review`

**工作流工具**: 只读子代理保留
- `connect_tool_source`（只读子代理可以启用更多只读工具）

**bash 限制**: 子代理只能执行前景命令（`run_in_background=false`），防止嵌套子代理创建不受控的后台进程。

---

## 10. Checkpoint 快照与 Rewind 机制

```
文件: internal/checkpoint/checkpoint.go (350行)
```

### 10.1 快照机制

Reasonix 的 Rewind 系统是**纯 Git-free** 的快照机制：

```go
type Checkpoint struct {
    Turn     int        `json:"turn"`      // 用户turn编号
    Time     time.Time  `json:"time"`      // 快照时间
    Prompt   string     `json:"prompt"`    // 用户输入
    MsgIndex int        `json:"msgIndex"`  // 对话回滚边界
    Files    []FileSnap `json:"files"`     // 文件快照列表
}
```

- **每次 turn 开始时**创建一个新 checkpoint
- **每次 writer tool 执行前**快照目标文件的原始内容（通过 `onPreEdit` hook）
- 每个文件在同一个 turn 内只快照一次（首次即 turn-start 状态）
- 持久化为 `<session>.ckpt/turn-<N>.json`

### 10.2 Rewind 能力

```
/rewind [turn] [code|conversation|both]
```

- **code**: 恢复 workspace 文件到指定 turn 开始时的状态
- **conversation**: 截断会话到指定 turn 的 `MsgIndex`
- **both**: 同时恢复代码和对话

**安全边界**: `safePath()` 确保恢复操作不能逃逸出 workspace 根目录。

---

## 11. Subagent 隔离与深度控制

### 11.1 深度限制

```go
const DefaultMaxSubagentDepth = 2
```

默认最大深度为 2（root → subagent → sub-subagent），当到达最大深度时：
- 递归委托工具（task, run_skill 等）从工具 schema 中移除
- `read_skill` 始终保留（它渲染 playbook 文本，不能递归）

### 11.2 工具过滤

子代理工具注册表构建 (`SubagentToolRegistryForDepth`):

```go
func SubagentToolRegistryForDepth(parent *tool.Registry, names []string, childDepth, maxDepth int) *tool.Registry {
    exclude := append([]string(nil), subagentAlwaysHiddenTools...)
    if childDepth >= NormalizeMaxSubagentDepth(maxDepth) {
        exclude = append(exclude, subagentRecursiveTools...)
    }
    exclude = append(exclude, subagentJobTools...)
    sub := FilterRegistry(parent, names, exclude...)
    if bash, ok := sub.Get("bash"); ok {
        sub.Add(foregroundOnlyBash{inner: bash})
    }
    return sub
}
```

### 11.3 子代理上下文隔离

- 子代理的主题 prompt 明确指示"聚焦于一个任务"
- 子代理不继承父代理的对话历史
- 子代理的最终答案作为 `task` tool 的输出返回给父代理

---

## 12. 图像压缩

```
文件: internal/control/imagecompress.go (77行)
```

用户附加的图像在发送给 vision-capable 模型前被压缩：

```go
const maxVisionDim = 1568           // 最大边长
const maxDecodePixels = 50_000_000  // 防压缩炸弹
```

- **PNG/GIF**: 缩小后仍保持 PNG（无损）—— 适合截图、文本、透明度
- **JPEG/WebP**: 缩小后转 JPEG Quality 85
- **变换算法**: CatmullRom scaling（高质量保持锐利度）
- **已合规**: 如果图像已在限制内则不重新编码
- **失败降级**: 解码失败时发送原始字节

---

## 13. 网络层优化

### 13.1 HTTP 传输配置

```go
// internal/provider/openai/openai.go:202-210
func newHTTPClient(cfg provider.Config) (*http.Client, error) {
    return netclient.NewHTTPClient(spec, netclient.TransportOptions{
        DialTimeout:           30 * time.Second,
        KeepAlive:             30 * time.Second,
        TLSHandshakeTimeout:   15 * time.Second,
        ResponseHeaderTimeout: 120 * time.Second, // 模型思考可能需要很长时间
    })
}
```

- **ResponseHeaderTimeout**: 120 秒的宽松超时 —— 推理模型在首批 token 前的"思考"阶段可能需要很长时间
- **Keep-Alive**: 30 秒的连接复用

### 13.2 SSE 流空闲超时

```go
const defaultStreamIdleTimeout = 120 * time.Second
```

SSE 流的空闲 watchdog —— 如果 120 秒内没有任何字节到达，视为断开连接。这个超时足够宽松，因为正常流会持续输出 token 或 keepalive。

### 13.3 代理支持

`netclient` 包提供了统一的 HTTP 客户端，支持系统代理配置。

---

## 14. 死循环防护机制

### 14.1 Storm Breaker

```
文件: internal/agent/agent.go:400-440
```

检测模型陷入"重复失败相同操作"的死循环：

```go
stormSig   string  // 每轮 (tool, error/blocker) 的签名
stormCount int     // 连续相同签名的轮数
blockedTurnStreak int  // 连续被阻塞的轮数
repeatSuccessCounts map[string]int  // 同一turn内重复成功的操作计数
```

- 签名不是 `(tool, args)` 而是 `(tool, error/blocker)` —— 模型经常重新措辞/重排参数但仍然获得相同的拒绝
- 任何不同的失败形状或任何成功都会重置计数器
- 连续 2 次压缩（compact stuck）自动暂停自动压缩

### 14.2 Max Steps 守卫

```go
// agent.go:1026-1029
// With maxSteps <= 0 the loop is unbounded — the natural termination is
// the model finishing, and the real safety bounds are user cancellation
// and compaction, not a round count.
```

默认无限制（-1），真正的安全边界是用户取消和压缩，而不是硬性的回合计数。

### 14.3 Executor Handoff Guard

在双模型模式下，executor 带有一个标记确保它不会再次被 handoff 指令触发重复执行。

---

## 15. 配置参数汇总

### 15.1 上下文管理参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `soft_compact_ratio` | 0.5 | 软压缩通知阈值 |
| `tool_result_snip_ratio` | 0.6 | 工具结果截断阈值 |
| `compact_ratio` | 0.8 | 自动压缩触发阈值 |
| `compact_force_ratio` | 0.9 | 强制压缩高水位 |
| `compact_target` | 0.5 | 压缩后tail最大窗口占比 |
| `tail_tokens` | 16384 | 最近tail的token预算 |
| `recent_keep` | 2 | 最小保留消息数 |
| `context_window` | (provider) | 上下文窗口大小 |

### 15.2 Token 经济参数

| 参数 | 可选值 | 说明 |
|------|--------|------|
| `token_mode` | `full`, `economy` | 工具加载模式 |
| `economy_builtins` | 工具名列表 | 自定义economy模式核心工具集 |

### 15.3 MCP 启动参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `startup_budget` | (per-plugin) | 每个MCP插件的启动延迟预算 |

### 15.4 Subagent 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_subagent_depth` | 2 | 最大子代理嵌套深度 |

### 15.5 Provider 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `reasoning_effort` | auto | 思考深度 (low/medium/high/max/disabled) |
| `reasoning_protocol` | auto | 推理协议 (auto/deepseek/openai/none) |
| `temperature` | 0.7 | 生成温度 |
| `max_tokens` | (provider) | 最大输出token |

### 15.6 重试参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_retries` | 10 | 最大重试次数 |
| `max_backoff` | 15s | 最大退避延迟 |
| `max_auth_retries` | 2 | 认证重试次数 |

### 15.7 Memory v5 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `memory_compiler_verbosity` | `observe` | 编译器模式 (observe/compact) |
| `memory_compiler_injection_max` | 5 | 每会话最大注入次数 |
| `memory_compiler_injection_cooldown` | 30s | 注入冷却时间 |

---

## 附录：关键文件索引

| 文件 | 行数 | 核心优化 |
|------|------|----------|
| `internal/agent/agent.go` | 2938 | 核心Agent循环，Storm Breaker，maxToolOutput，Cache追踪 |
| `internal/agent/compact.go` | 760 | 分层压缩策略，Token校准，Summarizer |
| `internal/agent/prune.go` | 289 | Stale tool result snip/prune |
| `internal/agent/cache_shape.go` | 121 | PrefixShape对比，Cache诊断 |
| `internal/agent/coordinator.go` | 916 | 双模型协调，Planner/Executor隔离 |
| `internal/agent/task.go` | 949 | Subagent工具过滤，深度控制 |
| `internal/agent/task_classifier.go` | 337 | LLM+启发式任务分类，LRU缓存 |
| `internal/boot/token_profile.go` | 284 | Token经济模式，connect_tool_source |
| `internal/provider/retry.go` | 212 | 指数退避重试，连接重置检测 |
| `internal/provider/openai/openai.go` | 931 | DeepSeek协议，Provider检测 |
| `internal/plugin/lazy.go` | 420 | MCP懒加载状态机，Cache-hit Pinning |
| `internal/plugin/cache.go` | 245 | MCP Schema缓存，指纹哈希 |
| `internal/checkpoint/checkpoint.go` | 350 | Snapshot + Rewind |
| `internal/control/auto_plan_classifier.go` | 95 | Auto-Plan分类 |
| `internal/control/imagecompress.go` | 77 | Vision图像压缩 |
| `internal/memorycompiler/compression.go` | 1638 | 多维度执行压缩 |
| `internal/agent/width.go` | 41 | ANSI-aware输出宽度计算 |
