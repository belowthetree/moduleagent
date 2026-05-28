# ModuleAgent 测试方案与规范

## 一、现状

- 初始状态：仅 1 个 Playwright e2e 冒烟测试 (`e2e/smoke.spec.ts`) 和 1 个 renderer mock 文件，实际测试文件为零。
- 新增：**10 个测试文件，87 个测试用例**，覆盖 core、config、context、protocol 模块。
- 基础设施：`test/infrastructure/FauxAcpAgent.ts` 用于模拟 ACP agent 子进程。

## 二、测试分层架构

参考 pi-mono 项目的三层测试模型，ModuleAgent 分为四层：

```
┌──────────────────────────────────────────────────────────────┐
│ L4  端到端测试 (e2e/)                                         │
│     Playwright — 完整 Electron 应用流程                       │
├──────────────────────────────────────────────────────────────┤
│ L3  UI 交互测试 (renderer + TUI)                              │
│     Vue Test Utils + happy-dom — 组件渲染、Store、交互        │
├──────────────────────────────────────────────────────────────┤
│ L2  集成测试 (Agent 生命周期 + IPC + MCP transport)           │
│     FauxAcpAgent 内存连接替代真实子进程                        │
├──────────────────────────────────────────────────────────────┤
│ L1  单元测试 (纯逻辑层)                                       │
│     core 模块、config 模块、context 模块、protocol 常量        │
└──────────────────────────────────────────────────────────────┘
```

## 三、L1：单元测试（已实施）

**测试文件清单：**

| 模块 | 文件 | 测试数 |
|---|---|---|
| Core | `src/core/__tests__/ExclusionRules.test.ts` | 7 |
| Core | `src/core/__tests__/PathUtils.test.ts` | 6 |
| Core | `src/core/__tests__/ModuleParser.test.ts` | 7 |
| Core | `src/core/__tests__/ModuleScanner.test.ts` | 7 |
| Core | `src/core/__tests__/ModuleGraph.test.ts` | 9 |
| Config | `src/config/__tests__/schema.test.ts` | 11 |
| Config | `src/config/__tests__/defaults.test.ts` | 9 |
| Context | `src/context/__tests__/FileStore.test.ts` | 10 |
| Context | `src/context/__tests__/ContextManager.test.ts` | 8 |
| Protocol | `src/protocol/__tests__/IpcChannels.test.ts` | 5 |

### 3.1 Core 模块

#### ExclusionRules

- `BUILTIN_EXCLUDED_DIRS` 包含常见构建和依赖目录且无重复
- `isBuiltinExcluded()` 正确匹配排除目录和文件
- 正常目录/文件不被排除

#### PathUtils

- 空字符串原样返回
- 相对路径被 `path.resolve()` 展开
- Windows 盘符路径 (`E:\foo`) 在非 Windows 平台转为 `/mnt/e/foo`

#### ModuleParser

- 解析含 frontmatter 的 module.md
- 从 frontmatter 解析 subModules
- 无 frontmatter subModules 时回退到正文 `## 子模块` 列表
- 从 `## 模块说明` 标题提取 description
- 缺失 name 字段时使用 cwd basename
- 无 frontmatter 的 file 不崩溃
- 不存在文件的错误处理

#### ModuleScanner

- 不存在的项目根抛异常
- 无 module.md 返回空数组
- 找到根 module.md
- 找到嵌套 module.md
- 排除内置目录 (`node_modules`, `.git`)
- 支持 `extraExclude` 选项
- 为发现的模块创建 `experience.md` / `patterns.md`

#### ModuleGraph

- 单节点图构建
- 空描述符数组抛异常
- 无根模块抛异常
- `subModules` 定义建立父子关系
- 嵌套层级关系
- 重复描述符跳过
- 名称冲突回退到 relativePath
- `getSubtreeNames()` 正确返回子树
- 叶子节点返回空数组

### 3.2 Config 模块

#### schema

- `ProjectConfigSchema`：最小配置通过、模块覆写通过、缺少必要字段被拒、非法类型被拒
- `ConfigEntrySchema`：name 字段必须
- `RoleConfigSchema`：最小配置通过、空 name 被拒、默认值填充
- `WorkspaceConfigSchema`：含 configs 数组、含 roles 数组

#### defaults

- `DEFAULT_CONFIG` 与 `DEFAULT_CONFIG_ENTRY` 一致（向后兼容）
- `DEFAULT_CONFIG_ENTRY` 通过 schema 自检
- `DEFAULT_WORKSPACE_CONFIG` 通过 schema 自检、包含模块生成角色
- `DEFAULT_MODULE_GEN_ROLE` 包含 knowledgeRefs、visibleModulePaths 为空

### 3.3 Context 模块

#### FileStore

- 消息 round-trip（save → load 一致）
- 不存在的模块返回空数组
- save 覆盖已有消息
- remove 清除消息
- remove 不存在的模块不抛异常
- list 返回所有已保存模块名
- 排除非 JSON 文件
- 不同 FileStore 实例之间隔离

#### ContextManager

- 首次 `getMessages` 从 store 加载
- 缓存命中不重复读取
- 多模块隔离
- `addMessage` 追加并持久化
- `addMessage` 追加到已有消息之后
- `clearModule` 清除缓存和 store
- `clearAll` 清除所有模块
- `getModules` 返回 store 列表

### 3.4 Protocol 模块

#### IpcChannels

- 所有通道字符串值无重复
- Agent/Project/Config/Context 各组通道值正确

## 四、L2：集成测试基础设施

### FauxAcpAgent (`test/infrastructure/FauxAcpAgent.ts`)

参考 pi-mono 的 Faux Provider 设计，在内存中模拟 ACP agent 子进程：

```
TransformStream (client→agent) ─┐
                                 ├─ AgentSideConnection (可编程 Agent 实现)
TransformStream (agent→client) ─┘
```

**核心 API：**

```typescript
const faux = new FauxAcpAgent({
  sessionId: 'test-session',
  promptResponses: [
    // 第一次 prompt 的回复
    [
      { type: 'text', content: 'Hello from agent' },
      { type: 'tool_call', name: 'read_file', args: { path: '/test.txt' } },
      { type: 'end_turn', stopReason: 'end_turn' },
    ],
  ],
});

// 注入 AgentLauncher
const launcher = new AgentLauncher();
const agent = await launcher.launch(config, name, cwd, logger, {
  createConnection: FauxAcpAgent.createFactory(faux),
});

// 断言
expect(faux.getReceivedPrompts()).toHaveLength(1);
expect(faux.getReceivedPrompts()[0].text).toBe('hello');
```

**AgentLauncher 注入点：** `LaunchOptions.createConnection` 可选参数，接受 `ConnectionFactory` 类型，默认使用真实的 `createAgentConnection`，测试时替换为 `FauxAcpAgent.createFactory(faux)`。

## 五、测试命名规范

| 类型 | 命名格式 | 目录 |
|---|---|---|
| 单元测试 | `<模块名>.test.ts` | 与源文件同目录的 `__tests__/` |
| 集成测试 | `<功能>-integration.test.ts` | `test/integration/` |
| E2E 测试 | `<功能>.spec.ts` | `e2e/` |

## 六、Mock 策略

| 外部依赖 | Mock 方式 |
|---|---|
| ACP agent 子进程 | `FauxAcpAgent` 内存流对 |
| Electron `ipcMain`/`ipcRenderer` | 创建 FakeIpcBus（事件发射器模拟） |
| 文件系统（临时数据） | 真实 `node:fs` 操作 `tmpdir()`，afterEach 清理 |
| `window.moduleAgent` API | `createMockModuleAgentApi()` + `triggerStream`/`triggerStatus` |
| MCP transport | 直接调用 `server.handleRequest()` 而不通过 stdio |

## 七、运行命令

```bash
# 全部 L1 测试
node node_modules/vitest/vitest.mjs run --root . src/core/__tests__/ src/config/__tests__/ src/context/__tests__/ src/protocol/__tests__/

# 全部测试 (含已有)
npm run test

# E2E
npm run test:e2e

# 类型守卫
npm run typecheck
```

## 八、待补充测试（按优先级）

| 优先级 | 内容 | 状态 |
|---|---|---|
| P0 | L1 Core/Config/Context/Protocol 单元测试 | 已完成 (87 tests) |
| P1 | L2 FauxAcpAgent 基础设施 + AgentLauncher 集成测试 | 基础设施已完成，集成测试待写 |
| P2 | L2 MCPServer / RoleMCPServer / CommunicationBus 集成测试 | 待写 |
| P3 | L3 Pinia Store 测试 (projectStore, agentStore, configStore) | 目录已有，待填充 |
| P4 | L3 Vue 组件测试 (ChatInput, LeftSidebar, SetupView) | 待写 |
| P5 | L4 E2E (setup-flow, agent-chat, tree-navigation) | 待写 |
