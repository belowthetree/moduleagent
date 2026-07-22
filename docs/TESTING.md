# ModuleAgent 测试方案与规范

## 一、现状

- **类型检查**：`pnpm run typecheck`（`tsc --noEmit`）已从 317 个错误降到 **0**，是当前最主要的质量门禁。
- **单元/组件测试**：`pnpm run test`（vitest run）— **25 个测试文件，158 个用例，全部通过**。
- **E2E**：`e2e/smoke.spec.ts` 共 1 条 Playwright 冒烟测试。
- ACP 时代的 `test/infrastructure/FauxAcpAgent.ts` 已随 ACP 子进程层一并删除（内核模式无子进程可模拟）。
- vitest `exclude` 在默认排除之外追加：`e2e/**`、`.opencode/**`、`.claude/**`、`.sisyphus/**`、`.reasonix/**`、`.module-agent/**`（防止各工具产物目录里的零散测试文件混入）。

## 二、测试分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ L4  端到端测试 (e2e/)                                         │
│     Playwright — 普通 Chromium 中加载 electron-vite dev       │
│     server 的渲染层（非 Electron 壳），当前仅 1 条 smoke       │
├──────────────────────────────────────────────────────────────┤
│ L3  UI 交互测试 (renderer)                                    │
│     Vue Test Utils + happy-dom — SVGTree 组件、Pinia stores   │
├──────────────────────────────────────────────────────────────┤
│ L2  内核/子系统测试 (src/agents/**)                            │
│     进程内内核直接实例化；vi.mock('ai') 替换 generateText      │
├──────────────────────────────────────────────────────────────┤
│ L1  单元测试 (纯逻辑层)                                       │
│     core 模块、config 模块、protocol 常量、main 工具函数       │
└──────────────────────────────────────────────────────────────┘
```

## 三、测试文件清单（158 用例）

| 模块 | 文件 | 测试数 |
|---|---|---|
| Core | `src/core/__tests__/ExclusionRules.test.ts` | 7 |
| Core | `src/core/__tests__/PathUtils.test.ts` | 2 |
| Core | `src/core/__tests__/ModuleParser.test.ts` | 7 |
| Core | `src/core/__tests__/ModuleScanner.test.ts` | 8 |
| Core | `src/core/__tests__/ModuleGraph.test.ts` | 9 |
| Core | `src/core/__tests__/AgentSubsystemUtils.test.ts` | 3 |
| Config | `src/config/__tests__/schema.test.ts` | 11 |
| Config | `src/config/__tests__/defaults.test.ts` | 11 |
| Config | `src/config/__tests__/ConfigLoader.test.ts` | 10 |
| Protocol | `src/protocol/__tests__/IpcChannels.test.ts` | 5 |
| Agents | `src/agents/__tests__/Agent.test.ts` | 4 |
| Agents | `src/agents/__tests__/KernelFactory.test.ts` | 10 |
| Agents | `src/agents/__tests__/McpBackend.test.ts` | 3 |
| Agents | `src/agents/__tests__/StreamAccumulator.test.ts` | 2 |
| Agents | `src/agents/kernel/__tests__/AgentLoop.test.ts` | 5 |
| Agents | `src/agents/kernel/__tests__/ProviderResolver.test.ts` | 7 |
| Agents | `src/agents/kernel/__tests__/Sandbox.test.ts` | 9 |
| Agents | `src/agents/kernel/__tests__/execute-command.test.ts` | 3 |
| Agents | `src/agents/kernel/__tests__/git-operations.test.ts` | 8 |
| Agents | `src/agents/lifecycle/__tests__/RoleAgentManager.test.ts` | 2 |
| Main | `src/main/handlers/__tests__/fileNameSanitize.test.ts` | 4 |
| Renderer | `src/renderer/src/components/__tests__/SVGTree.test.ts` | 8 |
| Renderer | `src/renderer/src/stores/__tests__/agent.test.ts` | 11 |
| Renderer | `src/renderer/src/stores/__tests__/config.test.ts` | 6 |
| Renderer | `src/renderer/src/stores/__tests__/stream.test.ts` | 3 |

### 3.1 Core 模块（36 用例）

- **ExclusionRules**：内置排除目录/文件清单无重复、匹配与误伤检查
- **PathUtils**：空串原样返回、相对路径 resolve（WSL 盘符转换用例已随 `normalizeCodeSourcePath` 收敛）
- **ModuleParser**：frontmatter 解析、`## 模块说明` 提取 description、无 frontmatter 容错、缺失 name 回退 basename
- **ModuleScanner**：递归发现 module.md、内置/额外排除、自动创建 experience.md/patterns.md、模块名路径分隔符规范化（Windows 反斜杠安全）
- **ModuleGraph**：单节点/嵌套图构建、subModules 父子关系、重名回退 relativePath、重复描述符跳过、getSubtreeNames
- **AgentSubsystemUtils（SendGuard）**：真 promise 链互斥——同名三路并发严格串行、持有者未释放时等待、释放后可重入、不同名互不影响

### 3.2 Config 模块（32 用例）

- **schema**：ProjectConfigSchema / ConfigEntrySchema / RoleConfigSchema / WorkspaceConfigSchema 的最小通过、必填拒绝、默认值填充
- **defaults**：DEFAULT_CONFIG 与 DEFAULT_CONFIG_ENTRY 一致（内核模式无 command/args）、各默认对象通过 schema 自检、DEFAULT_MODULE_GEN_ROLE 含 knowledgeRefs
- **ConfigLoader**：load/loadOrCreate/getDefaultConfig 回落行为；`loadWithStatus()` 在 zod 校验失败时暴露可读错误详情（不再静默吞错）

### 3.3 Protocol 模块（5 用例）

- **IpcChannels**：通道字符串无重复，Agent/Project/Config/Context 各组通道已定义

### 3.4 Agents 模块（53 用例）

- **Agent**：并发与队列（cancel() abort 在途调用并以 Canceled reject 全部排队项、agent 保持可复用；已 abort 的排队项执行前跳过；Error 状态 send 入队串行化）；`setConfigOption` 内核模式恒 false；`sessionResult` 不伪造 configOptions
- **KernelFactory.resolveConnectionConfig**：env 回落顺序 ANTHROPIC→OPENAI→GOOGLE→DEEPSEEK→DASHSCOPE 并按 key 推断 provider（DASHSCOPE→custom + dashscope 兼容端点）、显式配置优先于 env
- **McpBackend（CrossModuleRouter）**：wait-for 图多边环检测（A 等 B、C 时 B→A/C→A 均拒绝）；routeCall 不触碰目标模块用户流累积器、跨模块内容独立落盘；超时经 AbortSignal 真正取消在途 send
- **StreamAccumulator / SessionStore**：`appendCrossContext` 直写文件不经活跃流、重复调用追加；替换活跃流时 warn
- **AgentLoop**：多轮历史回归（第二次 send 收到完整 user/assistant 历史）；compact/truncate 后 ModelMessage[] 结构合法（无孤儿 tool 消息）；maxOutputTokens/temperature 透传；StormBreaker 干预消息入史
- **ProviderResolver**：四个内置 provider 在 baseUrl 非空时透传 baseURL、为空时用 SDK 默认端点；custom provider 端点回退
- **Sandbox**：realpath 包含校验——拒绝 symlink/junction 逃逸读写、`..` 词法逃逸、工作区外绝对路径；指向工作区内部的链接仍可用
- **execute-command**：env 白名单（buildSafeEnv 不含 API key 类变量、保留 PATH 等必要项）；工具描述不再声称"在沙箱内执行"
- **git-operations**：args 按 operation 白名单校验——拒绝 `--output=`、危险 flag（--exec/-c/--git-dir）、绝对路径、`..` pathspec；放行 `--` 后相对 pathspec（失败码 invalid_args）
- **RoleAgentManager.resolveRoleConfig**：透传 provider/apiKey/baseUrl/model/fastModel/contextWindow；可选字段缺省为 undefined（不伪造 command/args）

### 3.5 Main 模块（4 用例）

- **fileNameSanitize**：路径分隔符与 Windows 非法字符替换为 `_`；`../` 穿越清洗后不含分隔符；裸 `..` / `.` / 空名称拒绝；保留中文与空格

### 3.6 Renderer 模块（28 用例）

- **SVGTree**：渲染节点/连线数量、点击 emit select、折叠展开、缩放/平移边界、选中高亮、agent 状态点、空树不崩
- **agent store**：startAgent/sendMessage/cancelAgent 流程、contextMap 与 restoreContext、clearContext/clearAllContexts、cross-context 事件归位、push 事件维护 runningAgents
- **config store**：初始默认值、localStorage 读写、loadFromProject/saveToProject 映射、配置损坏时优雅 reject
- **stream composable**：sendMessage 先推 user 消息再走 IPC、失败路径、cancel 置 interrupted

## 四、L2：内核测试基础设施

内核模式没有子进程，测试直接实例化进程内组件：

```typescript
// mock ai.generateText（保留 stepCountIs / tool / jsonSchema 等真实实现）
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const loop = new AgentLoop({ kernelConfig: { provider: 'openai', apiKey: 'test-key', ... }, ... });
await loop.send([{ type: 'text', text: 'hello' }]);
// 断言 mockGenerateText 收到的 messages / maxOutputTokens / temperature
```

跨模块路由（CrossModuleRouter）与 SessionStore 同样进程内实例化测试，无需 HTTP 后端或 stdio transport。

## 五、测试命名规范

| 类型 | 命名格式 | 目录 |
|---|---|---|
| 单元测试 | `<模块名>.test.ts` | 与源文件同目录的 `__tests__/` |
| E2E 测试 | `<功能>.spec.ts` | `e2e/` |

## 六、Mock 策略

| 外部依赖 | Mock 方式 |
|---|---|
| LLM（ai-sdk `generateText`） | `vi.mock('ai')` 仅替换 `generateText`，保留其余真实实现 |
| Electron `ipcMain`/`ipcRenderer` | 不直接测；handler 纯逻辑（如 fileNameSanitize）抽出单测 |
| 文件系统（临时数据） | 真实 `node:fs` 操作 `tmpdir()`，afterEach 清理 |
| `window.moduleAgent` API | renderer `__mocks__/moduleAgent.ts` |
| 沙箱/子进程 | 真实 Sandbox + tmpdir 构造 symlink/junction 场景 |

## 七、运行命令

```bash
# 类型守卫（首要门禁，当前 0 错误）
pnpm run typecheck

# 全部单元/组件测试（25 文件 / 158 用例）
pnpm run test

# E2E（首次运行前需安装浏览器）
pnpm exec playwright install chromium
pnpm run test:e2e
```

E2E 说明：`playwright.config.ts` 通过 `webServer` 启动 `npx electron-vite dev`，在**普通 Chromium** 中访问 `http://localhost:5173`（渲染层 dev server），并非启动 Electron 壳；当前仅 1 条 smoke（页面标题 + `#app` 可见）。

## 八、待补充测试（按优先级）

| 优先级 | 内容 | 状态 |
|---|---|---|
| P0 | L1 Core/Config/Protocol 单元测试 | 已完成 |
| P0 | typecheck 全绿 | 已完成（317→0） |
| P1 | L2 内核/子系统测试（AgentLoop/Sandbox/git/Agent/McpBackend/StreamAccumulator/KernelFactory/ProviderResolver/RoleAgentManager） | 已完成 |
| P2 | L3 Pinia Store + SVGTree 组件测试 | 部分完成（agent/config/stream store + SVGTree） |
| P3 | L3 其余 Vue 组件测试（ChatInput, LeftSidebar, SetupView） | 待写 |
| P4 | L4 E2E 扩充（setup-flow, agent-chat, tree-navigation） | 仅 1 条 smoke，待扩充 |
