# Electron + Vue + Vite 架构迁移

## TL;DR

> **Quick Summary**: 将 Electron 渲染器从单文件 1064 行 vanilla TypeScript 迁移到 Vue 3 + Vite（electron-vite 构建工具、Element Plus 组件库、Pinia 状态管理、Vue Router），同时完全保留现有 preload API 和主进程 IPC 处理逻辑。
>
> **Deliverables**:
> - electron-vite 标准项目结构（`src/main/`, `src/preload/`, `src/renderer/`）
> - ~15 个 Vue SFC 组件替换单文件渲染器
> - 3 个 Pinia stores（config, project, agent）
> - Element Plus 暗色/亮色主题切换
> - TDD 测试套件（Vitest + Playwright）
> - 更新的构建流水线（electron-vite build + esbuild for CLI/MCP）
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 5 waves, max 8 concurrent
> **Critical Path**: Wave 0 scaffold → Wave 1 types → Wave 2 components → Wave 3 integration → Wave 4 build → Wave 5 tests

---

## Context

### Original Request
将架构改为 Electron + Vue + Vite

### Interview Summary
**Key Discussions**:
- **Vue 3**: Composition API + TypeScript（最新生态）
- **Element Plus**: 替换所有手写表单/按钮/模态框，支持暗色/亮色切换
- **electron-vite**: 标准构建工具（alex8088/electron-vite, 5.3k stars）
- **Pinia**: 状态管理（所有 500★+ OSS 项目在使用）
- **Vue Router**: 管理 Setup → Main 两个视图路由
- **TDD**: Vitest + Vue Test Utils + Playwright E2E
- **目录重组**: 按 electron-vite 标准结构 `src/main/`, `src/preload/`, `src/renderer/`
- **Preload API**: 13 个 IPC 方法完全保留，不做任何签名变更
- **暗色/亮色模式**: 支持切换

**Research Findings**:
- **electron-vite 标准结构**: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/` (Vue app)
- **IPC 模式**: 类型化 composables 封装 preload API（NOT provide/inject）
- **Dev**: Vite HMR for renderer, main process restart on change
- **安全**: sandbox + isolated preload build (externalizeDeps: false) for production
- **构建输出**: electron-vite → `out/main/`, `out/preload/`, `out/renderer/`; MCP/CLI → `dist/` 不变
- **当前渲染器**: 单文件 1064 行，零依赖，纯命令式 DOM 操作，全局可变状态

### Metis Review
**27 个 gap 已识别**（8 问题、17 护栏、9 范围蠕变、8 假设、12 验收标准、13 边界情况）

**已纳入计划的护栏**:
- Preload API 13 方法签名冻结
- localStorage keys 冻结（`ctx_<name>`, `lastWorkspace`, `lastProject` 等）
- IPC channel 名称不变
- Element Plus 组件限用 11 个（`el-input`, `el-button`, `el-dialog`, `el-drawer`, `el-select`, `el-option`, `el-card`, `el-form`, `el-form-item`, `el-pagination`, `el-scrollbar`）
- SVG 树图保持原始 SVG（不使用外部树库）
- 不添加任何新功能
- `@opentui/*` 依赖保留不动
- 功能 CSS 变量（`--drawer-width`, 布局, 动画）保留
- `tsc --noEmit` 现在覆盖 electron/ → 预期新增类型错误
- `setupDevHotReload` 移除已纳入范围
- 复用点击节点行为改为 no-op（UX 改进）

---

## Work Objectives

### Core Objective
将 Electron 渲染器从 vanilla TypeScript 单文件迁移到 Vue 3 + Vite 组件化架构，同时零回归保持 preload API 契约和主体进程逻辑。

### Concrete Deliverables
- electron-vite 标准目录结构（`src/main/`, `src/preload/`, `src/renderer/`）
- `electron.vite.config.ts` 配置文件
- `src/renderer/src/` 下的 Vue 3 应用（~15 SFC 组件）
- 3 个 Pinia stores：`configStore`, `projectStore`, `agentStore`
- `src/types/` 下的共享类型定义（`ModuleAgentApi`, `TreeNode`, `ChatMsg` 等）
- `MockModuleAgentApi` 用于测试
- `useModuleAgent` composable（封装 window.moduleAgent）
- 暗色/亮色主题切换（Element Plus dark class + localStorage 持久化）
- Vue Router 路由（`/setup` → `/main`）
- Vitest 测试套件（≥10 单元测试）
- Playwright E2E 烟雾测试
- 更新的 `package.json` scripts、`electron-builder.yml`
- 更新 `electron/main.ts`（BrowserWindow 双模式 loadURL/loadFile + 移除 `setupDevHotReload`）

### Definition of Done
- [ ] `npx tsc --noEmit` 零错误通过
- [ ] `npm run build:electron` 成功（electron-vite build + MCP/CLI esbuild）
- [ ] `out/main/index.js`, `out/preload/index.mjs`, `out/renderer/index.html` 存在
- [ ] `dist/mcp-server.cjs`, `dist/cli.cjs` 不受影响
- [ ] 18 个功能回归项全部通过（Playwright 验证）
- [ ] Vitest 测试套件全部通过
- [ ] 暗色/亮色切换正常工作
- [ ] `npm run dev` 启动 Vite dev server + Electron 窗口，HMR 工作

### Must Have
- 所有 13 个 preload IPC 方法签名不变
- localStorage keys 完全兼容（迁移前后数据互通）
- 主进程 IPC handler 逻辑不动（仅 BrowserWindow config + `setupDevHotReload` 移除）
- SVG 模块树功能完整（pan/zoom, collapse, agent status dots）
- 流式响应实时显示（thinking, tool_calls, reply）
- Cross-context 事件在抽屉中显示
- 3 秒轮询运行中 agent 状态

### Must NOT Have (Guardrails)
- **禁止**: 修改 IPC channel 名称或数据形状
- **禁止**: 修改主进程 AgentOrchestrator/McpBackend 逻辑
- **禁止**: 修改 MCP server 或 CLI 构建
- **禁止**: 使用 Element Plus 组件列表外的组件
- **禁止**: 使用外部 SVG 树图库（D3, vis.js 等）
- **禁止**: 添加模块搜索、Git URL 验证、loading skeletons 等新功能
- **禁止**: 修改 `@opentui/*` 依赖（CLI 使用）
- **禁止**: 更改 preload API 数据形状（除修复 `sessionId` 类型缺失外）
- **禁止**: 多余的抽象层（过度拆分组件、过早提取 utils）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO（当前无测试基础设施）
- **Automated tests**: TDD — 设置 Vitest + Vue Test Utils + Playwright
- **Framework**: Vitest (单元/组件测试), Playwright (E2E)
- **TDD Workflow**: 每个任务包含 RED（失败测试）→ GREEN（最小实现）周期

### QA Policy
每个任务包含 Agent-Executed QA Scenarios。Evidence 保存至 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

- **Frontend/UI**: Playwright — 导航、交互、DOM 断言、截图
- **CLI/Build**: Bash — 运行命令、验证输出
- **API**: Bash (curl) — 发送请求、断言状态码和响应

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (Foundation — 顺序执行):
├── Task  1: electron-vite 项目脚手架 [quick]
├── Task  2: 安装依赖 [quick]
├── Task  3: tsconfig 配置 [quick]
└── Task  4: Dev CSP 设置 [quick]

Wave 1 (Types + State — 最大并行):
├── Task  5: 共享类型定义 [quick]
├── Task  6: Preload 适配 + sessionId 类型修复 [quick]
├── Task  7: MockModuleAgentApi [quick]
├── Task  8: Pinia configStore [quick]
├── Task  9: Pinia projectStore [quick]
├── Task 10: Pinia agentStore [deep]
├── Task 11: IPC composable useModuleAgent [quick]
└── Task 12: Element Plus 主题系统（暗色/亮色）[quick]

Wave 2 (UI 组件 — 最大并行):
├── Task 13: SetupView.vue [visual-engineering]
├── Task 14: MainView.vue [visual-engineering]
├── Task 15: SVGTree.vue [deep]
├── Task 16: DrawerPanel.vue [unspecified-high]
├── Task 17: StreamArea.vue [unspecified-high]
├── Task 18: ContextCards.vue [unspecified-high]
├── Task 19: ChatInput.vue [visual-engineering]
├── Task 20: MessageModal.vue [visual-engineering]
├── Task 21: SettingsDialog.vue [visual-engineering]
└── Task 22: ThemeToggle.vue [visual-engineering]

Wave 3 (Integration — 最大并行，依赖 Wave 1+2):
├── Task 23: Vue Router 配置 [quick]
├── Task 24: Stream composable + 实时流集成 [deep]
├── Task 25: Cross-context composable [quick]
├── Task 26: Agent polling composable [quick]
└── Task 27: App.vue 根组件组装 [visual-engineering]

Wave 4 (Build System):
├── Task 28: electron.vite.config.ts [quick]
├── Task 29: 更新 main.ts（BrowserWindow 双模式 + 移除 hot-reload）[quick]
├── Task 30: 更新 package.json scripts [quick]
├── Task 31: electron-builder.yml 配置 [quick]
├── Task 32: 生产 CSP [quick]
└── Task 33: 全量构建验证 [quick]

Wave 5 (TDD Tests — 最大并行，依赖 Wave 1+2):
├── Task 34: ConfigStore 单元测试 [quick]
├── Task 35: AgentStore 单元测试 [quick]
├── Task 36: Stream composable 测试 [quick]
├── Task 37: SVGTree 组件测试 [quick]
└── Task 38: Playwright E2E 烟雾测试 [unspecified-high]

Critical Path: Task 1 → 2 → 3 → 5 → 10 → 15 → 24 → 27 → 28 → 29 → 33 → 38 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 10 (Wave 2)
```

### Agent Dispatch Summary

- **0**: **4** — T1-T4 → `quick`
- **1**: **8** — T5-T9,T11-T12 → `quick`, T10 → `deep`
- **2**: **10** — T13-T14,T19-T22 → `visual-engineering`, T15 → `deep`, T16-T18 → `unspecified-high`
- **3**: **5** — T23,T25-T26 → `quick`, T24 → `deep`, T27 → `visual-engineering`
- **4**: **6** — T28-T33 → `quick`
- **5**: **5** — T34-T37 → `quick`, T38 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. electron-vite 项目脚手架

  **What to do**:
  - 从当前 `electron/` 目录迁移到 electron-vite 标准结构
  - 创建 `src/main/index.ts`（从 `electron/main.ts` 拷贝，暂不改逻辑）
  - 创建 `src/preload/index.ts`（从 `electron/preload.ts` 拷贝）
  - 创建 `src/renderer/` 目录（Vue 应用根目录）
  - 保留 `electron/` 为 legacy 参考（不删除），在 `.gitignore` 中添加新路径
  - 旧文件标记 `// @legacy` 注释

  **Must NOT do**:
  - 不修改 main.ts 逻辑（仅移动）
  - 不删除 `electron/` 原目录
  - 不移动 `src/core/`, `src/agents/`, `src/config/` 等共享模块

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0 (sequential foundation)
  - **Blocks**: Task 2, Task 3, Task 5, Task 6, Task 28
  - **Blocked By**: None

  **References**:
  - `electron/main.ts` — 源代码，整体拷贝到 `src/main/index.ts`
  - `electron/preload.ts` — 源代码，整体拷贝到 `src/preload/index.ts`
  - `electron/renderer/` — 当前渲染器（参考，不移动）
  - `electron-vite.org/guide/dev#project-structure` — 标准目录结构参考

  **Acceptance Criteria**:
  - [ ] `src/main/index.ts` 存在，内容与原 `electron/main.ts` 一致
  - [ ] `src/preload/index.ts` 存在，内容与原 `electron/preload.ts` 一致
  - [ ] `src/renderer/` 目录已创建
  - [ ] 旧 `electron/main.ts` 和 `electron/preload.ts` 添加了 `// @legacy` 注释

  **QA Scenarios**:
  ```
  Scenario: 目录结构正确
    Tool: Bash (ls)
    Steps:
      1. ls src/main/index.ts → 文件存在
      2. ls src/preload/index.ts → 文件存在
      3. ls src/renderer/ → 目录存在
      4. head -1 electron/main.ts → 包含 "// @legacy"
    Expected Result: 所有文件/目录按预期存在
    Evidence: .sisyphus/evidence/task-1-structure.txt
  ```

  **Commit**: YES
  - Message: `scaffold: migrate to electron-vite project structure`
  - Files: `src/main/index.ts`, `src/preload/index.ts`, `electron/main.ts`, `electron/preload.ts`

- [x] 2. 安装依赖

  **What to do**:
  - 安装 Vue 3 生态：`vue`, `@vitejs/plugin-vue`
  - 安装 Element Plus：`element-plus`, `@element-plus/icons-vue`
  - 安装状态管理：`pinia`
  - 安装路由：`vue-router`
  - 安装 electron-vite：`electron-vite` (devDep)
  - 安装测试依赖：`vitest`, `@vue/test-utils`, `jsdom`, `@playwright/test` (devDep)
  - 安装 electron-vite Vue 模板：`@electron-toolkit/preload`, `@electron-toolkit/utils` (devDep)
  - 运行 `npm install`

  **Must NOT do**:
  - 不移除现有依赖（`@agentclientprotocol/sdk`, `zod`, `@opentui/*` 等）
  - 不升级 Electron 版本（保持 `^41.3.0`）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0
  - **Blocks**: Task 12, all Vue component tasks (13-22)
  - **Blocked By**: Task 1

  **Acceptance Criteria**:
  - [ ] `npm ls vue` 显示 vue 已安装
  - [ ] `npm ls element-plus` 显示 element-plus 已安装
  - [ ] `npm ls pinia` 显示 pinia 已安装
  - [ ] `npm ls vue-router` 显示 vue-router 已安装
  - [ ] `npm ls electron-vite` 显示 electron-vite (devDep) 已安装
  - [ ] `npm ls vitest` 显示 vitest (devDep) 已安装

  **QA Scenarios**:
  ```
  Scenario: 依赖安装成功
    Tool: Bash (npm ls)
    Steps:
      1. npm ls vue --depth=0 → 返回版本号（非空/非错误）
      2. npm ls element-plus --depth=0 → 返回版本号
      3. npm ls electron-vite --depth=0 → 返回版本号
    Expected Result: 所有关键依赖已安装
    Evidence: .sisyphus/evidence/task-2-deps.txt
  ```

  **Commit**: YES
  - Message: `deps: add Vue 3, Element Plus, Pinia, Vue Router, electron-vite, Vitest`
  - Files: `package.json`, `package-lock.json`

- [x] 3. tsconfig 配置

  **What to do**:
  - 创建 `tsconfig.json`（保持现有配置，覆盖 `src/`，排除 `src/renderer/`）
  - 创建 `tsconfig.node.json`（`src/main/` + `src/preload/`，`"module": "ESNext"`, `"moduleResolution": "bundler"`）
  - 创建 `tsconfig.web.json`（`src/renderer/`，`"jsx": "preserve"`, `"lib": ["ESNext", "DOM"]`）
  - 在 `tsconfig.json` 中通过 `references` 引用子配置
  - 在原 `tsconfig.json` 中添加 `exclude: ["src/renderer"]`，`include` 保持现有 `src/**/*.ts`
  - 运行 `npx tsc --noEmit` 验证配置

  **Must NOT do**:
  - 不改变 `src/` 核心代码的 tsconfig（`"jsx": "react-jsx"` 仅用于 `src/`）
  - 不删除原 tsconfig 中的 `paths` 或 `baseUrl`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 0
  - **Blocks**: Task 5, all component tasks
  - **Blocked By**: Task 1

  **References**:
  - `tsconfig.json` — 当前配置（保持 core 不变，添加 references）
  - `electron-vite.org/guide/dev#typescript` — electron-vite tsconfig 推荐配置

  **Acceptance Criteria**:
  - [ ] `tsconfig.json` 存在，`references` 指向 `tsconfig.node.json` 和 `tsconfig.web.json`
  - [ ] `tsconfig.node.json` 存在
  - [ ] `tsconfig.web.json` 存在
  - [ ] `npx tsc --noEmit` 能运行（可能有初始类型错误，但配置本身不报错）

  **QA Scenarios**:
  ```
  Scenario: tsconfig 文件结构正确
    Tool: Bash (cat + tsc)
    Steps:
      1. ls tsconfig.json tsconfig.node.json tsconfig.web.json → 三个文件存在
      2. npx tsc --noEmit 2>&1 | head -5 → 配置不报错（type errors from unmigrated code OK）
    Expected Result: 三个 tsconfig 文件存在且引用关系正确
    Evidence: .sisyphus/evidence/task-3-tsconfig.txt
  ```

  **Commit**: YES
  - Message: `config: add electron-vite tsconfig hierarchy`
  - Files: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`

- [x] 4. Dev CSP 设置

  **What to do**:
  - 在 `src/renderer/index.html` 中设置开发模式 CSP：
    `default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*`
  - Vite HMR 需要 `'unsafe-eval'`（Vue SFC 编译）和 `ws://`（HMR WebSocket）
  - 生产 CSP 留到 Task 32 处理（严格模式）

  **Must NOT do**:
  - 不在开发模式设置严格 CSP（会破坏 HMR）
  - 不修改原 `electron/renderer/index.html` 的 CSP

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 0
  - **Blocks**: None (后续任务依赖它，但不阻塞)
  - **Blocked By**: Task 1

  **References**:
  - `electron/renderer/index.html:6` — 当前 CSP meta 标签
  - `electron-vite.org/guide/dev#content-security-policy` — CSP 配置参考

  **Acceptance Criteria**:
  - [ ] `src/renderer/index.html` 存在，包含宽松 CSP meta 标签
  - [ ] `connect-src` 包含 `ws://localhost:*`

  **QA Scenarios**:
  ```
  Scenario: CSP meta 标签存在
    Tool: Bash (grep)
    Steps:
      1. grep "Content-Security-Policy" src/renderer/index.html → 包含 'unsafe-eval'
      2. grep "connect-src" src/renderer/index.html → 包含 'ws://'
    Expected Result: 开发模式 CSP 包含必要指令
    Evidence: .sisyphus/evidence/task-4-csp.txt
  ```

  **Commit**: YES
  - Message: `config: add dev CSP for Vite HMR compatibility`
  - Files: `src/renderer/index.html`

---

- [x] 5. 共享类型定义

  **What to do**:
  - 创建 `src/types/preload.ts` — 从 preload 和 renderer 提取所有共享类型
  - 定义 `ModuleAgentApi` 接口（13 方法完整签名，**含 `sessionId` 类型修复**）
  - 定义 `TreeNode`, `ScanResult`, `LayoutNode`, `ChatMsg` 接口（从 `electron/renderer/renderer.ts:1-20` 提取）
  - 定义 `AgentStatus` 类型：`'idle' | 'streaming' | 'error'`
  - 添加 `declare global { interface Window { moduleAgent: ModuleAgentApi } }` 全局声明
  - 确保 preload 和 renderer 都能 import 此文件

  **Must NOT do**:
  - 不改变原接口的数据形状（仅修复 `sessionId` 类型缺失）
  - 不添加新字段或方法

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 6-12)
  - **Blocks**: Task 6, Task 7, Task 11, all component tasks
  - **Blocked By**: Task 1

  **References**:
  - `electron/preload.ts:1-49` — 当前 API 类型签名（13 methods）
  - `electron/preload.ts:50` — `export type ModuleAgentApi = typeof api`
  - `electron/renderer/renderer.ts:1-21` — 当前 renderer 内联类型定义
  - `electron/renderer/renderer.ts:17-19` — `TreeNode`, `ScanResult`, `LayoutNode`, `ChatMsg` 接口

  **Acceptance Criteria**:
  - [ ] `src/types/preload.ts` 存在，导出 `ModuleAgentApi`, `TreeNode`, `ScanResult`, `LayoutNode`, `ChatMsg`, `AgentStatus`
  - [ ] `ModuleAgentApi.onAgentStream` 回调参数包含 `sessionId?: string`（类型修复）
  - [ ] `Window.moduleAgent` 全局声明存在
  - [ ] `npx tsc --noEmit` 在 `src/types/` 中无类型错误

  **QA Scenarios**:
  ```
  Scenario: 类型文件编译通过
    Tool: Bash (tsc)
    Steps:
      1. npx tsc --noEmit --project tsconfig.node.json 2>&1 | grep "src/types/preload" → 无错误
    Expected Result: 类型文件零类型错误
    Evidence: .sisyphus/evidence/task-5-types.txt
  ```

  **Commit**: YES
  - Message: `types: extract shared type definitions with sessionId fix`
  - Files: `src/types/preload.ts`

- [x] 6. Preload 适配 + sessionId 类型修复

  **What to do**:
  - 更新 `src/preload/index.ts`：
    - 从 `src/types/preload.ts` 导入 `ModuleAgentApi` 类型
    - 修复 `onAgentStream` 回调类型：添加 `sessionId?: string`
    - 为 `onCrossContext` 回调添加完整类型
    - 保持 `contextBridge.exposeInMainWorld('moduleAgent', api)` 不变
    - 保持所有 13 个方法的运行时实现不变
    - 导出 `ModuleAgentApi` 类型（供 renderer import）
  - 验证：对比原 `electron/preload.ts` 确保运行时行为一致

  **Must NOT do**:
  - 不改变任何 `ipcRenderer.invoke` / `ipcRenderer.on` 调用
  - 不添加 Zod 验证或错误处理逻辑
  - 不改变 `window.moduleAgent` 暴露名称

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 7, Task 11
  - **Blocked By**: Task 1, Task 5

  **References**:
  - `electron/preload.ts` — 原 preload 实现（完整对照）
  - `src/types/preload.ts` — 新类型定义（Task 5）

  **Acceptance Criteria**:
  - [ ] `src/preload/index.ts` 使用共享类型，无内联类型定义
  - [ ] `onAgentStream` 回调类型包含 `sessionId?: string`
  - [ ] 所有 13 个方法签名与原 `electron/preload.ts` 行为一致
  - [ ] `diff <(grep -E '(invoke|on)\(' electron/preload.ts) <(grep -E '(invoke|on)\(' src/preload/index.ts)` 无差异

  **QA Scenarios**:
  ```
  Scenario: Preload IPC 调用与原始一致
    Tool: Bash (diff)
    Steps:
      1. 提取旧 preload 的 ipcRenderer 调用 → 提取新 preload 的 ipcRenderer 调用
      2. diff 旧调用列表 新调用列表 → 无差异
    Expected Result: IPC 调用完全一致
    Evidence: .sisyphus/evidence/task-6-preload-diff.txt
  ```

  **Commit**: YES
  - Message: `refactor(preload): use shared types, fix sessionId in stream callback`
  - Files: `src/preload/index.ts`

---

- [x] 7. MockModuleAgentApi

  **What to do**:
  - 创建 `src/renderer/src/__mocks__/moduleAgent.ts`
  - 实现 `createMockModuleAgentApi(): ModuleAgentApi` 工厂函数
  - 每个方法返回合理的 mock 数据（避免真实 IPC）
  - `onAgentStream` 和 `onCrossContext` 返回 `EventEmitter` 模式的 mock
  - 提供 `triggerStream(mock, data)` 和 `triggerCrossContext(mock, data)` helper 函数
  - 在 `vitest.setup.ts` 中将 mock 挂载到 `window.moduleAgent`

  **Must NOT do**:
  - 不 import 真实的 `electron` 或 `ipcRenderer`
  - 不依赖真实文件系统或进程

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 34, Task 35, Task 36, Task 37
  - **Blocked By**: Task 5, Task 6

  **References**:
  - `src/types/preload.ts` — `ModuleAgentApi` 接口（所有 mock 方法必须匹配）
  - `electron/preload.ts:28-32` — `onAgentStream` 的真实实现（理解 cleanup 模式）
  - `electron/renderer/renderer.ts:741-761` — 真实 stream 回调的使用方式

  **Acceptance Criteria**:
  - [ ] `createMockModuleAgentApi()` 返回对象实现了所有 13 个 `ModuleAgentApi` 方法
  - [ ] `onAgentStream` 和 `onCrossContext` 返回 cleanup 函数
  - [ ] `triggerStream()` 能触发已注册的 stream 回调
  - [ ] vitest 配置引用此 mock（`globalSetup` 或 `setupFiles`）

  **QA Scenarios**:
  ```
  Scenario: Mock 实现完整 API
    Tool: Bash (vitest)
    Steps:
      1. 编写简单测试调用 mock 的每个方法
      2. npx vitest run → 测试通过
    Expected Result: 所有 13 个方法可调用且返回期望类型
    Evidence: .sisyphus/evidence/task-7-mock.txt
  ```

  **Commit**: YES
  - Message: `test: add MockModuleAgentApi for TDD workflow`
  - Files: `src/renderer/src/__mocks__/moduleAgent.ts`, vitest 配置

- [x] 8. Pinia configStore

  **What to do**:
  - 创建 `src/renderer/src/stores/config.ts`
  - 使用 Composition API 风格的 `defineStore('config', () => { ... })`
  - 管理状态：`agentCmd`, `agentArgs`, `workspacePath`, `projectPath`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`
  - 实现 `loadFromLocalStorage()` — 从 localStorage 恢复（keys: `agentCmd`, `agentArgs`, `lastWorkspace`, `lastProject`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`）
  - 实现 `saveToLocalStorage()` — 同步到 localStorage
  - 实现 `saveToProject(projectRoot)` — 调用 `window.moduleAgent.saveAgentConfig()`
  - 实现 `loadFromProject(projectRoot)` — 调用 `window.moduleAgent.getAgentConfig()`
  - 为每个字段写 RED→GREEN 测试（Task 34）

  **Must NOT do**:
  - 不改变 localStorage key 名称
  - 不添加 Zod 验证（保持当前松散验证风格）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 13, Task 21, Task 34
  - **Blocked By**: Task 5

  **References**:
  - `electron/renderer/renderer.ts:27-39` — 当前全局状态变量
  - `electron/renderer/renderer.ts:164-203` — `saveSettings()` localStorage + saveAgentConfig 逻辑
  - `electron/renderer/renderer.ts:983-996` — `init()` localStorage 恢复逻辑
  - `electron/preload.ts:35-39` — `saveAgentConfig` / `getAgentConfig` API 签名

  **Acceptance Criteria**:
  - [ ] Test: RED（初始空 store）→ GREEN（load/save 工作）
  - [ ] `configStore.loadFromLocalStorage()` 从 localStorage 恢复所有字段
  - [ ] `configStore.saveToLocalStorage()` 写入正确的 localStorage keys
  - [ ] `configStore.saveToProject()` 调用 `window.moduleAgent.saveAgentConfig`
  - [ ] 所有字段有正确的 TypeScript 类型

  **QA Scenarios**:
  ```
  Scenario: Config 持久化循环
    Tool: Bash (vitest)
    Preconditions: localStorage 预设 agentCmd='test-cmd'
    Steps:
      1. 创建 store 实例
      2. store.loadFromLocalStorage()
      3. 断言 store.agentCmd === 'test-cmd'
      4. store.agentCmd = 'new-cmd'
      5. store.saveToLocalStorage()
      6. 断言 localStorage.getItem('agentCmd') === 'new-cmd'
    Expected Result: 读写循环完整，数据一致
    Evidence: .sisyphus/evidence/task-8-config-store.txt
  ```

  **Commit**: YES
  - Message: `feat: add Pinia configStore with localStorage persistence`
  - Files: `src/renderer/src/stores/config.ts`, 测试文件（Task 34）

- [x] 9. Pinia projectStore

  **What to do**:
  - 创建 `src/renderer/src/stores/project.ts`
  - 管理状态：`treeRoot: TreeNode | null`, `flattenedNodes: LayoutNode[]`, `selectedNode: TreeNode | null`, `moduleCount: number`
  - 实现 `scanProject()` — 调用 `window.moduleAgent.scanProject()` + `getTree()`
  - 实现 `getTree()` — 获取当前模块树
  - 实现 `selectNode(node)` — 设置 selectedNode
  - 实现布局计算函数 `layoutTree()`（从原 `renderer.ts:904-922` 迁移算法）
  - 实现 `findParentName()` 和 `isCollapsedAncestor()`（从原 `renderer.ts:979-980` 迁移）

  **Must NOT do**:
  - 不改变布局算法的数值常量（`NODE_W=180`, `NODE_H=50`, `H_GAP=80`, `V_GAP=16`）
  - 不添加虚拟滚动或大型树优化

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 14, Task 15, Task 16
  - **Blocked By**: Task 5

  **References**:
  - `electron/renderer/renderer.ts:27-29` — `treeRoot`, `flattenedNodes`, `selectedNode` 状态
  - `electron/renderer/renderer.ts:903-922` — `layoutTree()` 递归布局算法
  - `electron/renderer/renderer.ts:979-980` — `findParentName()`, `isCollapsedAncestor()`
  - `electron/preload.ts:7-11` — `scanProject` / `getTree` API 签名

  **Acceptance Criteria**:
  - [ ] `projectStore.scanProject(root, workspace)` 成功设置 `treeRoot`
  - [ ] `layoutTree()` 为 2 层深度的树生成正确的 `LayoutNode` 坐标
  - [ ] `findParentName(childNode)` 返回正确的父节点名

  **QA Scenarios**:
  ```
  Scenario: 树布局计算
    Tool: Bash (vitest)
    Steps:
      1. 创建 2 层测试树（root → [child1, child2]）
      2. 调用 projectStore.layoutTree(root, 0, 0, true)
      3. 断言 root.x === 0, root.y === 0
      4. 断言 child1.x === NODE_W + H_GAP, child2.x === NODE_W + H_GAP
      5. 断言 child2.y > child1.y + NODE_H
    Expected Result: 坐标符合递归布局算法
    Evidence: .sisyphus/evidence/task-9-project-store.txt
  ```

  **Commit**: YES
  - Message: `feat: add Pinia projectStore with tree layout algorithm`
  - Files: `src/renderer/src/stores/project.ts`

- [x] 10. Pinia agentStore

  **What to do**:
  - 创建 `src/renderer/src/stores/agent.ts`
  - 管理状态：
    - `runningAgents: Map<string, 'idle' | 'streaming' | 'error'>`
    - `streamState: Map<string, { reply, thinking, tools, finished?, sections }>`
    - `contextMap: Map<string, ChatMsg[]>`（对话上下文）
    - `ctxPage: Map<string, number>`（分页状态）
    - `sendingLock: boolean`
    - `streamListenerCleanup: (() => void) | null`
  - 实现 `startAgent(moduleName, cmd, args, cwd)` — 调用 `window.moduleAgent.startAgent()`
  - 实现 `sendMessage(moduleName, text)` — 完整的 send → stream → finish 流程
  - 实现 `cancelAgent(moduleName)`, `stopAgent(moduleName)`
  - 实现 `ensureStreamListener()` — 注册 `onAgentStream` 回调（从 `renderer.ts:739-762` 迁移）
  - 实现 `refreshRunningAgents()` — 3 秒轮询（从 `renderer.ts:41-54` 迁移）
  - 实现 `saveStreamSnapshot()` / `restoreStreamSnapshot()` / `clearStreamSnapshot()` — 从 `renderer.ts:690-737` 迁移
  - 实现 `saveContext(moduleName)` / `loadContext(moduleName)` / `clearContext(moduleName)` — 从 `renderer.ts:764-783` 迁移
  - 实现 context cards 分页逻辑（从 `renderer.ts:501-588` 迁移算法）

  **Must NOT do**:
  - 不改变 localStorage keys（`ctx_<name>`, `stream_snapshot`）
  - 不改变 stream chunk 处理逻辑（`agent_message_chunk`, `agent_thought_chunk`, `tool_call`）
  - 不改变 dedup 逻辑（`sendingLock`）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 16, Task 17, Task 18, Task 19, Task 24, Task 25, Task 26, Task 35
  - **Blocked By**: Task 5

  **References**:
  - `electron/renderer/renderer.ts:36-39` — `contextMap`, `ctxPage`, `runningAgents`, `runningPollTimer` 状态
  - `electron/renderer/renderer.ts:41-54` — `refreshRunningAgents()` + `startRunningPoll()`
  - `electron/renderer/renderer.ts:632-678` — `sendContextMsg()` 完整发送流程
  - `electron/renderer/renderer.ts:680-767` — `ensureStreamListener()`, `getStreamState()`, `saveStreamSnapshot()`, `restoreStreamSnapshot()`
  - `electron/renderer/renderer.ts:501-588` — `renderContextCards()` 分页逻辑
  - `electron/renderer/renderer.ts:764-783` — `saveContext()`, `loadContext()`, `clearContext()`
  - `electron/preload.ts:14-18` — `startAgent`, `sendMessage`, `cancelAgent`, `stopAgent` API

  **Acceptance Criteria**:
  - [ ] Test: Mock `window.moduleAgent.onAgentStream` → store 正确处理 chunk 数据
  - [ ] `sendMessage('test', 'hello')` 完整流程：start → send → stream → finish
  - [ ] `refreshRunningAgents()` 通过 mock 返回的 agent 列表更新 `runningAgents` Map
  - [ ] `saveStreamSnapshot()` → localStorage → `restoreStreamSnapshot()` → 数据一致
  - [ ] Context pagination 正确（5 条/页，多页导航）

  **QA Scenarios**:
  ```
  Scenario: Stream chunk 累积
    Tool: Bash (vitest)
    Preconditions: Mock onAgentStream 注册回调
    Steps:
      1. 调用 agentStore.sendMessage('test', 'hello')
      2. 触发 mock: { update: 'agent_message_chunk', data: { content: { type: 'text', text: 'Hi' } } }
      3. 断言 agentStore.streamState.get('test')?.reply === 'Hi'
      4. 触发 mock: { update: 'agent_thought_chunk', data: { content: { type: 'text', text: 'thinking...' } } }
      5. 断言 agentStore.streamState.get('test')?.thinking === 'thinking...'
    Expected Result: Reply 和 thinking 正确累积
    Evidence: .sisyphus/evidence/task-10-agent-store.txt

  Scenario: Stream snapshot 持久化
    Tool: Bash (vitest)
    Steps:
      1. 设置 streamState: { test: { reply: 'partial reply', thinking: '', tools: '', finished: false } }
      2. 调用 agentStore.saveStreamSnapshot()
      3. 断言 localStorage 有 'stream_snapshot' key
      4. 解析 JSON → 断言有 { moduleName: 'test', reply: 'partial reply' }
    Expected Result: Snapshot 正确序列化到 localStorage
    Evidence: .sisyphus/evidence/task-10-snapshot.txt
  ```

  **Commit**: YES
  - Message: `feat: add Pinia agentStore with stream, context, and snapshot management`
  - Files: `src/renderer/src/stores/agent.ts`

- [x] 11. IPC composable useModuleAgent

  **What to do**:
  - 创建 `src/renderer/src/composables/useModuleAgent.ts`
  - 导出 `useModuleAgent()` composable 函数
  - 直接返回 `window.moduleAgent` 的引用（类型化为 `ModuleAgentApi`）
  - 可选：添加 `onError` 回调包装（统一的错误日志）
  - 注入 store 集成点（供 Task 24/25 使用）

  **Must NOT do**:
  - 不使用 `provide/inject` 模式（全局 `window.moduleAgent` 足够）
  - 不添加额外的 Promise 包装层（保留原始 IPC 调用）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: All component tasks that call IPC (13-22)
  - **Blocked By**: Task 5, Task 6

  **References**:
  - `src/types/preload.ts` — `ModuleAgentApi` 类型
  - `electron/renderer/renderer.ts:22` — 当前 `declare global { interface Window { moduleAgent } }`

  **Acceptance Criteria**:
  - [ ] `useModuleAgent()` 返回类型为 `ModuleAgentApi`
  - [ ] 组件中可调用 `const api = useModuleAgent(); await api.selectDir('test')`

  **QA Scenarios**:
  ```
  Scenario: Composable 返回正确类型
    Tool: Bash (npx vitest)
    Steps:
      1. 在测试中调用 useModuleAgent()
      2. 断言返回对象有 selectDir, scanProject, startAgent 等方法
      3. TypeScript 编译通过（无类型错误）
    Expected Result: Composable 类型正确
    Evidence: .sisyphus/evidence/task-11-composable.txt
  ```

  **Commit**: YES
  - Message: `feat: add useModuleAgent composable`
  - Files: `src/renderer/src/composables/useModuleAgent.ts`

- [x] 12. Element Plus 主题系统（暗色/亮色）

  **What to do**:
  - 在 `src/renderer/src/main.ts` 中配置 Element Plus：
    - 导入 Element Plus 和样式
    - 注册中文 locale
    - 根据 localStorage `theme` key 设置初始暗色模式
  - 创建 `src/renderer/src/composables/useTheme.ts`
  - 管理 `isDark: ref<boolean>` 状态
  - `toggleTheme()` — 切换 `document.documentElement.classList.toggle('dark')`
  - `persistTheme()` — 写入 `localStorage.setItem('theme', isDark ? 'dark' : 'light')`
  - 在 pinia configStore 中集成 theme 字段（或独立 `useTheme` composable）
  - 保留原 CSS 中的功能性变量（`--drawer-width`, 布局相关），仅颜色由 Element Plus 管理

  **Must NOT do**:
  - 不删除原 CSS 中的功能性变量（`--drawer-width`, flex 布局等）
  - 不硬编码颜色值在任何组件中（使用 Element Plus CSS 变量）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 22, 所有 UI 组件（它们依赖主题）
  - **Blocked By**: Task 2

  **References**:
  - Element Plus docs: `element-plus.org/en-US/guide/dark-mode` — 暗色模式 CSS class 切换
  - `electron/renderer/style.css:7-22` — 原 Tokyo Night CSS 变量（颜色变量将被替换）

  **Acceptance Criteria**:
  - [ ] `document.documentElement.classList` 初始值与 localStorage `theme` 一致
  - [ ] `toggleTheme()` 切换 `dark` class 并持久化到 localStorage
  - [ ] Element Plus 组件在暗色模式下正确渲染（暗色背景 + 亮色文本）

  **QA Scenarios**:
  ```
  Scenario: 暗色模式切换
    Tool: Playwright
    Steps:
      1. page.goto('http://localhost:5173')
      2. 点击 theme toggle 按钮
      3. 断言 document.documentElement.classList 包含 'dark'
      4. 断言 localStorage.getItem('theme') === 'dark'
      5. 再次点击 → 断言 classList 不包含 'dark'
    Expected Result: 切换按钮正确切换 class 和 localStorage
    Evidence: .sisyphus/evidence/task-12-theme.png
  ```

  **Commit**: YES
  - Message: `feat: add Element Plus dark/light theme system`
  - Files: `src/renderer/src/main.ts`, `src/renderer/src/composables/useTheme.ts`

---

- [x] 13. SetupView.vue

  **What to do**:
  - 创建 `src/renderer/src/views/SetupView.vue`
  - 使用 Element Plus 组件重写设置界面：
    - `el-card` 作为容器（替换 `.setup-card`）
    - `el-form` + `el-form-item` 布局表单
    - `el-input` 替换手动 `<input>`
    - `el-select` + `el-option` 替换 `<select>`（codeSourceType）
    - `el-button` 替换浏览和开始按钮
  - 字段：
    - Agent 命令（`agent-cmd-input`）
    - Agent 参数（`agent-args-input`）
    - 工作目录（`workspace-input` + 浏览按钮 → `selectDir`）
    - 项目目录（`project-input` + 浏览按钮 → `selectDir`）
    - 代码来源类型（`setup-code-src-type` select）
    - 本地代码路径（`setup-code-path` + 浏览按钮）
  - 从 `configStore` 加载初始值（`loadFromLocalStorage()`）
  - "开始扫描" 按钮调用 `projectStore.scanProject()` → router.push('/main')
  - 禁用逻辑：workspace AND project 都填了才启用按钮
  - 错误显示：`el-alert` 或内联错误消息

  **Must NOT do**:
  - 不添加 Git URL 字段（Git 代码来源功能标注为"即将支持"，当前 disabled）
  - 不添加表单验证规则（保持松散验证）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 23, Task 27
  - **Blocked By**: Task 8, Task 11

  **References**:
  - `electron/renderer/index.html:13-73` — 原设置界面 HTML 结构
  - `electron/renderer/renderer.ts:860-894` — `startScan()` 逻辑
  - `electron/renderer/renderer.ts:983-1002` — `init()` 设置部分
  - `electron/renderer/style.css:34-73` — 原设置样式

  **Acceptance Criteria**:
  - [ ] 所有表单字段渲染正确
  - [ ] 浏览按钮打开原生目录选择器
  - [ ] "开始扫描" 禁用逻辑正确（workspace AND project 都有值才启用）
  - [ ] 扫描成功后跳转到 `/main`

  **QA Scenarios**:
  ```
  Scenario: 完整设置流程
    Tool: Playwright
    Steps:
      1. page.goto('http://localhost:5173/#/setup')
      2. page.fill('#agent-cmd-input', 'opencode')
      3. 断言 #btn-start 按钮 disabled（workspace 和 project 为空）
      4. page.fill('#workspace-input', '/tmp/ws')
      5. page.fill('#project-input', '/tmp/proj')
      6. 断言 #btn-start 按钮 enabled
      7. page.click('#btn-start')
      8. 等待导航 → 断言 URL 变为 /main
    Expected Result: 表单交互和导航正确
    Evidence: .sisyphus/evidence/task-13-setup.png
  ```

  **Commit**: YES
  - Message: `feat: add SetupView with Element Plus form components`
  - Files: `src/renderer/src/views/SetupView.vue`

- [x] 14. MainView.vue

  **What to do**:
  - 创建 `src/renderer/src/views/MainView.vue`
  - 主界面布局 shell：
    - FAB 按钮组（绝对定位）：返回、重新扫描、清空所有上下文、设置、主题切换
    - 树图面板（`SVGTree` 组件，flex: 1 填充）
    - 状态栏（底部固定）
  - 抽屉（`DrawerPanel` 组件，由 selectedNode 控制显示）
  - 动态显示模式：tree 面板左对齐 + 抽屉右滑入
  - 从 `projectStore` 读取 `treeRoot` 传递给 SVGTree

  **Must NOT do**:
  - 不在此组件中包含树图渲染或抽屉内容的具体实现（委托给子组件）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 23, Task 27
  - **Blocked By**: Task 9, Task 11

  **References**:
  - `electron/renderer/index.html:76-93` — 原主界面 HTML 结构
  - `electron/renderer/renderer.ts:1004-1016` — FAB 按钮事件绑定
  - `electron/renderer/style.css:76-97` — FAB 按钮样式
  - `electron/renderer/style.css:153-168` — 主界面和树面板布局

  **Acceptance Criteria**:
  - [ ] FAB 按钮渲染正确（5 个按钮：返回、重扫、清空、设置、主题）
  - [ ] 状态栏显示正确（连接状态、agent 信息、项目路径）
  - [ ] 抽屉在 selectedNode 非 null 时显示
  - [ ] 布局与原始应用一致

  **QA Scenarios**:
  ```
  Scenario: 主界面布局
    Tool: Playwright
    Preconditions: projectStore 有 treeRoot 数据
    Steps:
      1. page.goto('http://localhost:5173/#/main')
      2. 断言 .fab-back 可见
      3. 断言 .status-bar 可见，包含文本内容
      4. 断言 SVG 元素存在于 .tree-panel 中
    Expected Result: 主界面 shell 渲染正确
    Evidence: .sisyphus/evidence/task-14-main.png
  ```

  **Commit**: YES
  - Message: `feat: add MainView layout shell with FAB buttons and status bar`
  - Files: `src/renderer/src/views/MainView.vue`

- [x] 15. SVGTree.vue

  **What to do**:
  - 创建 `src/renderer/src/components/SVGTree.vue`
  - 使用 Vue 3 Composition API + `<svg>` 模板直接渲染
  - Props: `root: TreeNode`, `selectedNode: TreeNode | null`, `runningAgents: Map<string, string>`
  - Emits: `select(node: TreeNode)`, `collapse(node: TreeNode)`
  - 迁移算法：
    - `layoutTree()` — 递归布局（从 `renderer.ts:904-922` 迁移）
    - `renderSvg()` — SVG 生成（从 `renderer.ts:924-978` 迁移）
    - `findParentName()`, `isCollapsedAncestor()` — 辅助函数
  - Pan/Zoom 交互：
    - 中键拖拽（`mousedown button=1`）
    - 滚轮缩放（`wheel` 事件，`scale` 0.3-2.5）
    - 右键阻止默认菜单
  - 节点渲染：
    - `<rect>` 使用 `@click` 触发 select emit
    - `<circle>` expand 按钮触发 collapse toggle
    - Agent 状态点（`dot-idle`, `dot-streaming`, `dot-error`）
    - 边线（`<path>` 贝塞尔曲线）
  - 响应式：`watch` selectedNode → 高亮 active 节点

  **Must NOT do**:
  - 不使用 D3、vis.js 或任何外部树图库
  - 不改变节点大小和间距常量（`NODE_W=180`, `NODE_H=50`, `H_GAP=80`, `V_GAP=16`）
  - 不添加虚拟滚动

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14（MainView 依赖它）, Task 37
  - **Blocked By**: Task 9

  **References**:
  - `electron/renderer/renderer.ts:903-922` — `layoutTree()` 算法
  - `electron/renderer/renderer.ts:924-978` — `renderSvg()` SVG 生成
  - `electron/renderer/renderer.ts:213-249` — Pan/Zoom 交互
  - `electron/renderer/renderer.ts:979-980` — `findParentName()`, `isCollapsedAncestor()`
  - `electron/renderer/style.css:476-502` — SVG 节点样式

  **Acceptance Criteria**:
  - [ ] 树图渲染：2 层节点正确显示 rect + 连线 + 文本
  - [ ] Pan：中键拖拽改变 translate
  - [ ] Zoom：滚轮改变 scale（0.3-2.5 范围）
  - [ ] Collapse：点击 +/- 按钮收起/展开子树
  - [ ] 点击节点 emit select 事件
  - [ ] Active 节点有高亮样式
  - [ ] Agent 状态点正确渲染（idle/streaming/error 三种颜色）

  **QA Scenarios**:
  ```
  Scenario: 基本树渲染
    Tool: Playwright
    Preconditions: projectStore 加载了 2 层测试树
    Steps:
      1. page.goto('http://localhost:5173/#/main')
      2. 断言 .node-rect 元素 >= 3（root + 2 children）
      3. 断言 .edge-line 元素 >= 2
    Expected Result: SVG 包含正确数量的节点和边
    Evidence: .sisyphus/evidence/task-15-tree.png

  Scenario: Pan/Zoom
    Tool: Playwright
    Steps:
      1. page.mouse.move(treeCenter)
      2. page.mouse.down({ button: 'middle' })
      3. page.mouse.move(treeCenter.x+100, treeCenter.y+100)
      4. page.mouse.up()
      5. 断言 #tree-svg style.transform 包含 'translate'
      6. page.mouse.wheel(0, -100)  // zoom in
      7. 断言 transform scale 值变化
    Expected Result: Pan 和 Zoom 正确改变 SVG transform
    Evidence: .sisyphus/evidence/task-15-panzoom.png

  Scenario: Collapse/expand
    Tool: Playwright
    Preconditions: 树有至少 1 个有子节点的叶子
    Steps:
      1. 点击 expand-btn（+ 按钮）
      2. 断言子节点消失
      3. 再次点击 expand-btn（− 按钮）
      4. 断言子节点重新出现
    Expected Result: Collapse toggle 工作
    Evidence: .sisyphus/evidence/task-15-collapse.png
  ```

  **Commit**: YES
  - Message: `feat: add SVGTree component with pan/zoom and collapse`
  - Files: `src/renderer/src/components/SVGTree.vue`

- [x] 16. DrawerPanel.vue

  **What to do**:
  - 创建 `src/renderer/src/components/DrawerPanel.vue`
  - 使用 `el-drawer` 或自定义实现（保持原 drawer 动画和 resize 功能）
  - Props: `node: TreeNode`, `visible: boolean`
  - Emits: `close`
  - 抽屉内容：
    - 头部（模块名 + 关闭按钮）
    - 信息栏（路径、子模块数、Agent CWD）
    - 描述文本
    - 分流区域（splitter）：
      - 上半：`StreamArea` 组件（流式输出）
      - 下半：`ContextCards` 组件（对话历史）
    - 底部：`ChatInput` 组件
  - 抽屉 resize：拖拽 `#drawer-resize-handle` 改变 `--drawer-width` CSS 变量
  - Splitter：拖拽分界线改变 stream 和 context 区域的比例
  - Resize 和 splitter 比例持久化到 localStorage

  **Must NOT do**:
  - 不改变 drawer 动画（`transition: right 0.3s cubic-bezier`）
  - 不改变 splitter 比例范围（0.15-0.75）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Task 9, Task 10

  **References**:
  - `electron/renderer/renderer.ts:393-498` — `openDrawer()`, `closeDrawer()`, `buildDrawerContent()`
  - `electron/renderer/renderer.ts:252-284` — drawer resize 实现
  - `electron/renderer/renderer.ts:593-628` — splitter 实现
  - `electron/renderer/style.css:181-231` — drawer 样式和动画
  - `electron/renderer/style.css:260-278` — splitter 样式

  **Acceptance Criteria**:
  - [ ] 抽屉从右侧滑入（animation 与原始一致）
  - [ ] Drawer resize 拖拽正常工作
  - [ ] Splitter 拖拽正常工作
  - [ ] Resize 宽度和 splitter 比例持久化到 localStorage

  **QA Scenarios**:
  ```
  Scenario: Drawer 打开/关闭
    Tool: Playwright
    Steps:
      1. 点击 SVG 节点 → 断言 drawer 可见且 .open class 存在
      2. 点击关闭按钮 → 断言 drawer 隐藏
    Expected Result: Drawer 滑入/滑出动画正确
    Evidence: .sisyphus/evidence/task-16-drawer.png

  Scenario: Drawer resize
    Tool: Playwright
    Steps:
      1. 打开 drawer
      2. page.mouse.move(handle.left, handle.centerY)
      3. page.mouse.down()
      4. page.mouse.move(handle.left - 50, handle.centerY)
      5. page.mouse.up()
      6. 断言 drawer width > 原始 width
      7. 关闭 → 重新打开 → 断言 width 保持不变（持久化）
    Expected Result: Resize 持久化正确
    Evidence: .sisyphus/evidence/task-16-resize.png
  ```

  **Commit**: YES
  - Message: `feat: add DrawerPanel with resize and splitter`
  - Files: `src/renderer/src/components/DrawerPanel.vue`

- [x] 17. StreamArea.vue

  **What to do**:
  - 创建 `src/renderer/src/components/StreamArea.vue`
  - Props: `moduleName: string`
  - 从 `agentStore` 读取 `streamState.get(moduleName)`
  - 显示三个 stream section：
    - Thinking（`stream-section-thinking`）：可折叠，默认展开
    - Tools（`stream-section-tools`）：工具调用日志
    - Reply（`stream-section-reply`）：Agent 回复文本
  - 活跃流时显示闪烁光标（`.stream-active::after`）
  - Finish 后 collapse thinking 为 toggle（从 `renderer.ts:322-355` 迁移 `finishStream` 中的 thinking toggle 逻辑）
  - 取消按钮：调用 `agentStore.cancelAgent(moduleName)`
  - 自动滚动到底部

  **Must NOT do**:
  - 不改变 stream data 处理格式
  - 不添加 Markdown 渲染（保持纯文本）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 16
  - **Blocked By**: Task 10

  **References**:
  - `electron/renderer/renderer.ts:287-391` — stream 显示逻辑
  - `electron/renderer/renderer.ts:322-355` — `finishStream()` thinking toggle
  - `electron/renderer/style.css:279-396` — stream 样式（thinking, tools, reply sections）
  - `electron/renderer/style.css:398-412` — 取消按钮样式

  **Acceptance Criteria**:
  - [ ] Thinking section 显示并支持折叠
  - [ ] Tools section 显示工具调用
  - [ ] Reply section 显示回复文本
  - [ ] 活跃流时闪烁光标出现
  - [ ] 取消按钮在流进行中可见/可点击

  **QA Scenarios**:
  ```
  Scenario: Stream 实时更新
    Tool: Playwright
    Preconditions: agentStore 在流模式
    Steps:
      1. 在 agentStore 中触发 chunk 事件
      2. 断言 .stream-thinking 内容包含新增文本
      3. 断言 .stream-active::after 伪元素可见（闪烁光标）
    Expected Result: Stream 内容实时更新
    Evidence: .sisyphus/evidence/task-17-stream.png
  ```

  **Commit**: YES
  - Message: `feat: add StreamArea component with thinking/tools/reply sections`
  - Files: `src/renderer/src/components/StreamArea.vue`

- [x] 18. ContextCards.vue

  **What to do**:
  - 创建 `src/renderer/src/components/ContextCards.vue`
  - Props: `moduleName: string`
  - 从 `agentStore` 读取 `contextMap.get(moduleName)` 和 `ctxPage.get(moduleName)`
  - 渲染分页卡片列表（`CTX_PAGE=5` 条/页）：
    - 每条消息：role badge（用户/Agent/跨模块）、状态 badge、thinking toggle、tool count、内容预览（前 100 字）、时间
  - 点击卡片 → emit `showDetail(msg)` → `MessageModal` 显示详情
  - 分页器（使用 `el-pagination` 或自定义按钮组）：
    - 上一页/下一页按钮
    - 页码按钮（高亮当前页）
    - 总计数标签
  - Thinking toggle：点击展开/折叠（动画 + arrow 旋转）
  - 清空按钮：emit clear 事件

  **Must NOT do**:
  - 不改变 `CTX_PAGE=5` 的分页大小
  - 不改变卡片数据结构

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 16
  - **Blocked By**: Task 10

  **References**:
  - `electron/renderer/renderer.ts:501-588` — `renderContextCards()` 完整逻辑
  - `electron/renderer/renderer.ts:589-628` — 分页器逻辑
  - `electron/renderer/style.css:508-656` — context cards 样式

  **Acceptance Criteria**:
  - [ ] 卡片列表渲染正确（role, status, preview, time）
  - [ ] Thinking toggle 展开/折叠
  - [ ] 分页器正确（5 条/页，多页导航）
  - [ ] 点击卡片 emit showDetail 事件

  **QA Scenarios**:
  ```
  Scenario: Context cards 分页
    Tool: Playwright
    Preconditions: contextMap 有 12 条消息
    Steps:
      1. 断言 .ctx-card 元素 = 5（每页 5 条）
      2. 断言 .pg-btn 页码按钮 >= 3
      3. 点击第 3 页按钮
      4. 断言 .ctx-card 元素 = 2（第 3 页剩余 2 条）
    Expected Result: 分页正确
    Evidence: .sisyphus/evidence/task-18-cards.png
  ```

  **Commit**: YES
  - Message: `feat: add ContextCards component with pagination`
  - Files: `src/renderer/src/components/ContextCards.vue`

- [x] 19. ChatInput.vue

  **What to do**:
  - 创建 `src/renderer/src/components/ChatInput.vue`
  - `el-input` + `el-button` 组合
  - Props: `moduleName: string`, `disabled: boolean`（sendingLock）
  - Emits: `send(text: string)`
  - Enter 键发送，禁用状态时 input 和按钮都 disabled
  - 发送后清空 input 并保持 focus
  - 调用 `agentStore.sendMessage(moduleName, text)`

  **Must NOT do**:
  - 不添加自动完成或表情选择器

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 16
  - **Blocked By**: Task 10

  **References**:
  - `electron/renderer/renderer.ts:632-678` — `sendContextMsg()` 逻辑
  - `electron/renderer/style.css:685-713` — chat input 样式

  **Acceptance Criteria**:
  - [ ] Enter 发送消息并清空 input
  - [ ] 发送中 input 和按钮 disabled
  - [ ] 发送完成后恢复 focus

  **QA Scenarios**:
  ```
  Scenario: 发送消息
    Tool: Playwright
    Steps:
      1. page.fill('#ctx-chat-input', 'hello agent')
      2. page.press('#ctx-chat-input', 'Enter')
      3. 断言 input value 为空
      4. 断言 sendingLock 期间 input disabled
      5. 等待发送完成 → 断言 input enabled 且有 focus
    Expected Result: 发送流程正确
    Evidence: .sisyphus/evidence/task-19-chat.png
  ```

  **Commit**: YES
  - Message: `feat: add ChatInput component with send-on-enter`
  - Files: `src/renderer/src/components/ChatInput.vue`

- [x] 20. MessageModal.vue

  **What to do**:
  - 创建 `src/renderer/src/components/MessageModal.vue`
  - 使用 `el-dialog` 组件
  - Props: `visible: boolean`, `message: ChatMsg | null`
  - Emits: `close`
  - 详情显示：
    - 状态行（status badge + role label）
    - 信息网格（时间、模块、Agent、角色）
    - Thinking section（可折叠）
    - Tools section
    - Reply section（完整内容，非截断）
  - Thinking toggle 与原始行为一致
  - 关闭：点击遮罩、关闭按钮、Esc 键

  **Must NOT do**:
  - 不改变模态窗的内容结构

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 16
  - **Blocked By**: Task 5（ChatMsg 类型）

  **References**:
  - `electron/renderer/renderer.ts:796-857` — `showModal()` 逻辑
  - `electron/renderer/style.css:717-812` — 模态窗样式
  - `electron/renderer/index.html:109-117` — 模态窗 HTML 结构

  **Acceptance Criteria**:
  - [ ] 模态窗显示消息详情（所有 sections）
  - [ ] Thinking toggle 可折叠
  - [ ] Esc 键关闭模态窗
  - [ ] 点击遮罩关闭

  **QA Scenarios**:
  ```
  Scenario: 消息详情查看
    Tool: Playwright
    Preconditions: 有 ChatMsg 数据（含 thinking, tools, reply）
    Steps:
      1. 点击 context card → 断言 el-dialog 可见
      2. 断言 .modal-thinking-toggle 存在
      3. 点击 thinking toggle → 断言 thinking content 可见
      4. 按下 Escape → 断言 dialog 关闭
    Expected Result: 详情弹窗完整显示
    Evidence: .sisyphus/evidence/task-20-modal.png
  ```

  **Commit**: YES
  - Message: `feat: add MessageModal component for chat detail view`
  - Files: `src/renderer/src/components/MessageModal.vue`

- [x] 21. SettingsDialog.vue

  **What to do**:
  - 创建 `src/renderer/src/components/SettingsDialog.vue`
  - 使用 `el-dialog` 或 `el-drawer`
  - 字段与 SetupView 类似但布局更紧凑：
    - Agent 命令 + Agent 参数
    - 工作目录 + 浏览按钮
    - 项目目录 + 浏览按钮
    - 代码来源类型 select（local/git）
    - 本地代码路径（条件显示）
    - Git URL + 分支（条件显示，目前 disabled）
  - 从 `configStore` 加载当前值
  - 保存按钮：调用 `configStore.saveToLocalStorage()` + `saveToProject()`
  - 如果 projectPath 改变 → 触发重新扫描
  - 保存后更新状态栏

  **Must NOT do**:
  - 不添加 modulesPath 字段（用户确认 projectRoot 即是 modulesPath）
  - 不添加未在当前 UI 中的新配置项

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Task 8, Task 11

  **References**:
  - `electron/renderer/renderer.ts:77-210` — `openSettings()`, `saveSettings()` 逻辑
  - `electron/renderer/renderer.ts:205-210` — `updateStatusBar()`
  - `electron/renderer/style.css:120-150` — settings grid 样式

  **Acceptance Criteria**:
  - [ ] 所有字段从 configStore 加载当前值
  - [ ] 保存后 configStore 和 localStorage 更新
  - [ ] projectPath 改变后触发重新扫描
  - [ ] 代码来源切换正确显示/隐藏字段组

  **QA Scenarios**:
  ```
  Scenario: 设置保存
    Tool: Playwright
    Steps:
      1. 打开设置对话框
      2. 更改 agent 命令为 'custom-cmd'
      3. 点击保存
      4. 断言 localStorage.getItem('agentCmd') === 'custom-cmd'
      5. 重新打开设置 → 断言 input value === 'custom-cmd'
    Expected Result: 设置持久化正确
    Evidence: .sisyphus/evidence/task-21-settings.png
  ```

  **Commit**: YES
  - Message: `feat: add SettingsDialog with config persistence`
  - Files: `src/renderer/src/components/SettingsDialog.vue`

- [x] 22. ThemeToggle.vue

  **What to do**:
  - 创建 `src/renderer/src/components/ThemeToggle.vue`
  - `el-button` 或 `el-switch` 切换暗色/亮色模式
  - 使用 `useTheme()` composable
  - 图标：太阳 ☀️ / 月亮 🌙（或 Element Plus 图标）
  - 放置在 FAB 按钮组中

  **Must NOT do**:
  - 不添加复杂动画

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Task 12

  **References**:
  - Task 12 创建的 `useTheme` composable

  **Acceptance Criteria**:
  - [ ] 点击切换暗色/亮色模式
  - [ ] 图标在太阳/月亮间切换
  - [ ] 模式持久化到 localStorage

  **QA Scenarios**:
  ```
  Scenario: 主题切换
    Tool: Playwright
    Steps:
      1. 初始状态：检查 document.documentElement.classList
      2. 点击 ThemeToggle
      3. 断言 classList 已切换（dark 添加/移除）
      4. 断言 localStorage 'theme' key 更新
      5. 刷新页面 → 断言主题保持一致
    Expected Result: 主题切换和持久化正确
    Evidence: .sisyphus/evidence/task-22-theme.png
  ```

  **Commit**: YES
  - Message: `feat: add ThemeToggle component for dark/light mode`
  - Files: `src/renderer/src/components/ThemeToggle.vue`

---

- [x] 23. Vue Router 配置

  **What to do**:
  - 创建 `src/renderer/src/router/index.ts`
  - 定义两条路由：
    - `/setup` → `SetupView.vue`
    - `/main` → `MainView.vue`
  - 默认重定向 `/` → `/setup`
  - 使用 `createRouter({ history: createWebHashHistory() })`（hash 模式适配 Electron file:// 协议）
  - 路由守卫：如果没有 projectPath → 重定向到 `/setup`
  - 在 `src/renderer/src/main.ts` 中注册 router

  **Must NOT do**:
  - 不使用 HTML5 history 模式（Electron 不支持）
  - 不添加路由过渡动画（保持简洁）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 27
  - **Blocked By**: Task 13, Task 14

  **References**:
  - `electron/renderer/renderer.ts:893` — 原 `hide(setup-screen)` / `show(main-screen)` 过渡（现在改为路由导航）
  - Vue Router docs: `router.vuejs.org/guide/essentials/history-mode` — hash vs HTML5

  **Acceptance Criteria**:
  - [ ] `/` 重定向到 `/setup`
  - [ ] 扫描成功后 `router.push('/main')` 正确导航
  - [ ] 返回按钮 → `router.push('/setup')` 正确导航
  - [ ] 无 projectPath 时访问 `/main` → 重定向到 `/setup`

  **QA Scenarios**:
  ```
  Scenario: 路由导航
    Tool: Playwright
    Steps:
      1. page.goto('http://localhost:5173/') → 断言 URL 含 #/setup
      2. 完成扫描 → 断言 URL 含 #/main
      3. 点击返回 FAB → 断言 URL 含 #/setup
    Expected Result: 路由导航正确
    Evidence: .sisyphus/evidence/task-23-router.txt
  ```

  **Commit**: YES
  - Message: `feat: add Vue Router with setup and main routes`
  - Files: `src/renderer/src/router/index.ts`, `src/renderer/src/main.ts`

- [x] 24. Stream composable + 实时流集成

  **What to do**:
  - 增强 `agentStore` 的 `ensureStreamListener()` 方法（或创建独立的 `useStream` composable）
  - 确保 stream listener 在应用级别注册一次（在 `App.vue` 的 `onMounted` 中调用）
  - 处理 chunk 类型：
    - `agent_message_chunk` → append to reply（通过 `agentStore` 写入 streamState）
    - `agent_thought_chunk` → append to thinking
    - `tool_call` → append to tools
    - `plan` → 显示计划更新提示
  - `finishStream` 逻辑：collapse thinking to toggle
  - 取消按钮调用 `cancelAgent`
  - 自动滚动到 stream 底部
  - Stream snapshot 持久化（通过 `scheduleStreamSave` 防抖）

  **Must NOT do**:
  - 不改变 chunk 数据的解析方式
  - 不改变 `finishStream` 中的 thinking toggle 转换逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 27
  - **Blocked By**: Task 10, Task 17

  **References**:
  - `electron/renderer/renderer.ts:680-767` — stream listener 和 snapshot 管理
  - `electron/renderer/renderer.ts:287-391` — stream 显示函数

  **Acceptance Criteria**:
  - [ ] Stream listener 在应用启动时注册
  - [ ] Chunk 数据正确路由到对应 moduleName 的 streamState
  - [ ] Thinking toggle 在 finish 时正确转换
  - [ ] Stream snapshot 在 2 秒防抖后持久化
  - [ ] 关闭抽屉时 stream 继续缓冲（不丢失数据）

  **QA Scenarios**:
  ```
  Scenario: 跨组件 stream 通信
    Tool: Playwright
    Steps:
      1. 发送消息给 moduleA
      2. 关闭 drawer（断言 stream 继续缓冲）
      3. 重新打开 drawer → 断言 stream content 恢复
      4. 等待 stream finish → 断言 thinking 变为 toggle
    Expected Result: Stream 在组件间正确通信
    Evidence: .sisyphus/evidence/task-24-stream-integration.png
  ```

  **Commit**: YES
  - Message: `feat: integrate real-time stream with snapshot persistence`
  - Files: `src/renderer/src/stores/agent.ts`

- [x] 25. Cross-context composable

  **What to do**:
  - 在 `agentStore` 中添加 cross-context listener 注册方法
  - 调用 `window.moduleAgent.onCrossContext(callback)`
  - 回调数据追加到对应 moduleName 的 contextMap：
    ```typescript
    getMsgs(moduleName).push({
      id: 'x' + Date.now(),
      role: 'cross',
      content, thinking: '', tools: '',
      time, status: 'completed',
      moduleName, agentCmd: '',
      crossDirection: direction,
      crossModule,
    })
    ```
  - 如果当前 drawer 打开的正是该 moduleName → 自动刷新 context cards
  - 自动跳转到最新页（一致于 sendMessage 行为 — 修复 Metis 发现的 E5 不一致 bug）
  - 持久化到 localStorage

  **Must NOT do**:
  - 不改变 cross-context 数据的处理方式

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 27
  - **Blocked By**: Task 10

  **References**:
  - `electron/renderer/renderer.ts:1028-1049` — cross-context listener 和 handler
  - `electron/preload.ts:42-46` — `onCrossContext` API

  **Acceptance Criteria**:
  - [ ] Cross-context 事件正确追加到 contextMap
  - [ ] 当前 drawer 匹配时自动刷新
  - [ ] Cross-context 消息自动跳转到最新页
  - [ ] 持久化到 localStorage（`ctx_<name>` key）

  **QA Scenarios**:
  ```
  Scenario: Cross-context 事件
    Tool: Playwright
    Preconditions: drawer 打开在 moduleA
    Steps:
      1. 触发 mock cross-context 事件: { moduleName: 'moduleA', crossModule: 'moduleB', direction: 'received', phase: 'request', content: 'test', time: '12:00' }
      2. 断言 .ctx-role.cross 出现在 context cards 中
      3. 断言 page navigator 自动跳转到最新页
    Expected Result: Cross-context 事件正确显示
    Evidence: .sisyphus/evidence/task-25-cross-context.png
  ```

  **Commit**: YES
  - Message: `feat: add cross-context event integration with auto-pagination`
  - Files: `src/renderer/src/stores/agent.ts`

- [x] 26. Agent polling composable

  **What to do**:
  - 在 `agentStore` 中实现 `startRunningPoll()` / `stopRunningPoll()`
  - 3 秒间隔调用 `window.moduleAgent.getRunningAgents()`
  - 更新 `runningAgents` Map
  - 在 MainView 的 `onMounted` 中启动，`onUnmounted` 中停止
  - 如果已经是 streaming 状态 → 不 poll（避免不必要的调用）

  **Must NOT do**:
  - 不改变 polling 间隔（3 秒）
  - 不改变 agent 状态判断逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 27
  - **Blocked By**: Task 10

  **References**:
  - `electron/renderer/renderer.ts:41-59` — `refreshRunningAgents()`, `startRunningPoll()`, `stopRunningPoll()`

  **Acceptance Criteria**:
  - [ ] Polling 在 MainView 挂载时启动
  - [ ] 3 秒后 `runningAgents` Map 更新
  - [ ] SVGTree 响应式更新 agent status dots
  - [ ] 切换到 SetupView → polling 停止

  **QA Scenarios**:
  ```
  Scenario: Agent 状态 polling
    Tool: Playwright
    Preconditions: mock getRunningAgents 返回 [{ name: 'test', status: 'streaming' }]
    Steps:
      1. 导航到 /main
      2. 等待 3 秒
      3. 断言 SVG node 有 .dot-streaming class
    Expected Result: Agent 状态点正确显示
    Evidence: .sisyphus/evidence/task-26-polling.png
  ```

  **Commit**: YES
  - Message: `feat: add 3-second agent status polling`
  - Files: `src/renderer/src/stores/agent.ts`

- [x] 27. App.vue 根组件组装

  **What to do**:
  - 创建 `src/renderer/src/App.vue`
  - 结构：
    ```vue
    <template>
      <el-config-provider :locale="zhCn">
        <router-view />
        <ThemeToggle />
      </el-config-provider>
    </template>
    ```
  - `onMounted`：初始化 configStore、确保 stream listener 注册
  - 导入 Element Plus CSS 变量和全局样式
  - 设置 `document.documentElement` 初始 class（从 localStorage `theme`）
  - 注册 Pinia（通过 `createPinia()` 在 main.ts 中）

  **Must NOT do**:
  - 不添加全局 loading 状态或错误边界（保持简单）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 28（build 配置需要知道入口文件）
  - **Blocked By**: Task 23, Task 24, Task 25, Task 26

  **References**:
  - Element Plus docs: `element-plus.org/en-US/guide/i18n` — locale 配置
  - `electron/renderer/renderer.ts:983-1064` — `init()` 初始化逻辑（localStorage 恢复、事件绑定）

  **Acceptance Criteria**:
  - [ ] App 挂载后 configStore 数据从 localStorage 恢复
  - [ ] Element Plus 中文 locale 生效
  - [ ] 初始主题 class 正确（与 localStorage 一致）
  - [ ] Stream listener 在应用级别注册

  **QA Scenarios**:
  ```
  Scenario: 应用初始化
    Tool: Playwright
    Preconditions: localStorage 预设 agentCmd='test', theme='dark'
    Steps:
      1. 导航到应用
      2. 断言 document.documentElement.classList 包含 'dark'
      3. 断言 SetupView 表单中 agent-cmd-input 值为 'test'
    Expected Result: 初始状态从 localStorage 正确恢复
    Evidence: .sisyphus/evidence/task-27-init.png
  ```

  **Commit**: YES
  - Message: `feat: add App.vue root component with Element Plus config`
  - Files: `src/renderer/src/App.vue`, `src/renderer/src/main.ts`

---

- [x] 28. electron.vite.config.ts

  **What to do**:
  - 创建项目根目录下的 `electron.vite.config.ts`
  - 三段配置：
    ```typescript
    export default defineConfig({
      main: {
        build: { outDir: 'out/main' },
        resolve: { alias: { '@': resolve('src') } }
      },
      preload: {
        build: { outDir: 'out/preload' }
      },
      renderer: {
        build: { outDir: 'out/renderer' },
        plugins: [vue()],
        resolve: { alias: { '@': resolve('src/renderer/src') } }
      }
    })
    ```
  - Main process externalize：electron, fs-extra, gray-matter, marked, simple-git, zod, @agentclientprotocol/sdk, path, url, esbuild
  - Preload build：`externalizeDeps: false`（sandbox 需要全量打包）
  - Renderer：`@vitejs/plugin-vue` 插件
  - 设置 `renderer.server.port: 5173`

  **Must NOT do**:
  - 不在此文件中配置 MCP server 或 CLI 构建（esbuild 独立处理）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 29, Task 33
  - **Blocked By**: Task 27（需要知道 renderer 入口）

  **References**:
  - `electron-vite.org/guide/build` — electron.vite.config.ts 配置参考
  - `package.json:9-10` — 原 main process esbuild externals 列表
  - `electron-vite.org/guide/isolated-build` — preload isolated build 配置

  **Acceptance Criteria**:
  - [ ] `electron-vite build` 无错误完成
  - [ ] `out/main/index.js` 存在（CJS）
  - [ ] `out/preload/index.mjs` 存在（ESM, 全量打包）
  - [ ] `out/renderer/index.html` 存在（Vite 构建输出）

  **QA Scenarios**:
  ```
  Scenario: electron-vite 构建成功
    Tool: Bash
    Steps:
      1. npx electron-vite build 2>&1
      2. 断言退出码 0
      3. ls out/main/index.js out/preload/index.mjs out/renderer/index.html → 所有文件存在
    Expected Result: 构建无错误，三端输出正确
    Evidence: .sisyphus/evidence/task-28-build.txt
  ```

  **Commit**: YES
  - Message: `build: add electron.vite.config.ts`
  - Files: `electron.vite.config.ts`

- [x] 29. 更新 main.ts（BrowserWindow 双模式 + 移除 hot-reload）

  **What to do**:
  - 更新 `src/main/index.ts`：
    - 修改 `createWindow()`：支持 dev/prod 双模式 URL 加载
    - Dev 模式：`win.loadURL(process.env.ELECTRON_RENDERER_URL)`（Vite dev server）
    - Prod 模式：`win.loadFile(join(__dirname, '../renderer/index.html'))`
    - Preload 路径更新：`path.join(__dirname, '../preload/index.mjs')`
    - 移除 `setupDevHotReload()` 函数及其调用
    - 移除 `import { context as esbuildContext } from 'esbuild'`
    - 移除 `fs.watch` 相关代码
    - Dev 模式自动打开 DevTools
    - 保留 `Menu.setApplicationMenu(null)`
  - 导入路径更新：`../src/core/` → `../../src/core/`（electron-vite 结构）

  **Must NOT do**:
  - 不修改任何 IPC handler 逻辑（仅 import 路径更新）
  - 不修改 window 大小或其他 BrowserWindow 配置
  - 不改变 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 33
  - **Blocked By**: Task 28

  **References**:
  - `electron/main.ts:60-77` — 原 `createWindow()` 函数
  - `electron/main.ts:356-377` — 原 `setupDevHotReload()` 函数（将被移除）
  - `electron/main.ts:1` — 旧 import 列表（移除 esbuild import）
  - `electron-vite-vue` main process: `github.com/electron-vite/electron-vite-vue/blob/main/electron/main/index.ts#L69-L73` — 双模式 URL 加载模式

  **Acceptance Criteria**:
  - [ ] Dev 模式：`ELECTRON_RENDERER_URL` 存在时 loadURL
  - [ ] Prod 模式：loadFile 回退
  - [ ] Preload 路径指向 `out/preload/index.mjs`
  - [ ] `setupDevHotReload` 完全移除
  - [ ] esbuild import 移除
  - [ ] `Menu.setApplicationMenu(null)` 保留

  **QA Scenarios**:
  ```
  Scenario: 双模式窗口加载
    Tool: Bash (grep)
    Steps:
      1. grep "ELECTRON_RENDERER_URL" src/main/index.ts → 存在
      2. grep "loadFile" src/main/index.ts → 存在（prod 回退）
      3. grep "setupDevHotReload" src/main/index.ts → 不存在
      4. grep "esbuild" src/main/index.ts → 不存在
    Expected Result: 代码正确适配 electron-vite 双模式
    Evidence: .sisyphus/evidence/task-29-main.txt
  ```

  **Commit**: YES
  - Message: `refactor(main): dual-mode loadURL/loadFile, remove esbuild hot-reload`
  - Files: `src/main/index.ts`

- [x] 30. 更新 package.json scripts

  **What to do**:
  - 更新 scripts：
    ```json
    {
      "dev": "electron-vite dev",
      "build:renderer": "electron-vite build",
      "build:main": "electron-vite build",
      "build:preload": "electron-vite build",
      "build:mcp-server": "esbuild src/protocol/mcp/server-entry.ts --bundle --outfile=dist/mcp-server.cjs --platform=node --format=cjs",
      "build:cli": "esbuild src/cli/index.ts --bundle --outfile=dist/cli.cjs --platform=node --format=cjs --external:@opentui/core --external:@opentui/solid --external:@opentui/keymap",
      "build:electron": "electron-vite build && npm run build:mcp-server && npm run build:cli",
      "electron": "npm run build:electron && electron .",
      "dist": "npm run build:renderer && electron-builder build --win portable",
      "typecheck": "tsc --noEmit",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test"
    }
    ```
  - 更新 `"main"` 字段：`"main": "out/main/index.js"`
  - 删去原单独 esbuild renderer/main/preload scripts

  **Must NOT do**:
  - 不改变 `build:mcp-server` 和 `build:cli` 的 esbuild 配置
  - 不改变 `dist` script 的 electron-builder 配置

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 33
  - **Blocked By**: Task 28

  **References**:
  - `package.json:7-18` — 当前 scripts
  - `electron-vite.org/guide/dev` — 推荐 scripts 配置

  **Acceptance Criteria**:
  - [ ] `npm run dev` 启动 electron-vite dev
  - [ ] `npm run build:electron` 执行 electron-vite build + MCP + CLI
  - [ ] `npm run test` 运行 vitest
  - [ ] `npm run typecheck` 运行 tsc --noEmit
  - [ ] `"main"` 指向 `out/main/index.js`

  **QA Scenarios**:
  ```
  Scenario: Scripts 正确
    Tool: Bash
    Steps:
      1. npm run build:electron 2>&1 → 退出码 0
      2. npm run test 2>&1 → 退出码 0（或先无测试但命令不报错）
    Expected Result: 所有新 script 可执行
    Evidence: .sisyphus/evidence/task-30-scripts.txt
  ```

  **Commit**: YES
  - Message: `build: update package.json scripts for electron-vite`
  - Files: `package.json`

- [x] 31. electron-builder.yml 配置

  **What to do**:
  - 创建 `electron-builder.yml`（或更新 package.json `"build"` 字段）
  - 配置：
    ```yaml
    appId: com.moduleagent.app
    productName: ModuleAgent
    directories:
      output: release
    files:
      - 'out/**/*'
      - 'dist/**/*'
      - 'src/**/*'
      - 'node_modules/**/*'
      - 'package.json'
      - '!**/.vscode/*'
      - '!electron.vite.config.*'
    win:
      target: portable
      icon: null
    asarUnpack:
      - 'node_modules/sqlite3'
    ```
  - 确保 `asarUnpack` 包含可能存在的 native 模块
  - 排除源码和配置文件

  **Must NOT do**:
  - 不改变 appId 或 productName
  - 不改变 win portable target

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 33
  - **Blocked By**: Task 28

  **References**:
  - `package.json:19-35` — 原 electron-builder 配置
  - `electron-vite.org/guide/distribution.html` — electron-builder 推荐配置

  **Acceptance Criteria**:
  - [ ] `electron-builder.yml` 存在且配置正确
  - [ ] `files` 包含 `out/**/*`, `dist/**/*`, `src/**/*`
  - [ ] `win.target` 为 `portable`

  **QA Scenarios**:
  ```
  Scenario: electron-builder 配置有效
    Tool: Bash (grep)
    Steps:
      1. cat electron-builder.yml | grep "out/\*\*/\*" → 存在
      2. cat electron-builder.yml | grep "target: portable" → 存在
    Expected Result: 配置包含正确的输出路径
    Evidence: .sisyphus/evidence/task-31-builder.txt
  ```

  **Commit**: YES
  - Message: `build: add electron-builder.yml for electron-vite output`
  - Files: `electron-builder.yml`

- [x] 32. 生产 CSP

  **What to do**:
  - 在 `src/renderer/index.html` 中添加条件 CSP：
    - Dev 模式：宽松 CSP（已在 Task 4 设置）
    - Prod 模式：严格 CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'">`
  - Vite 生产构建不会注入 `'unsafe-eval'` 或 `ws://` 连接
  - 使用 `import.meta.env.DEV` 或构建时代码替换控制

  **Must NOT do**:
  - 不阻塞 Vite HMR 在 dev 模式下的功能

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 33
  - **Blocked By**: Task 4

  **References**:
  - `electron/renderer/index.html:6` — 原 CSP
  - `electron-vite.org/guide/dev#content-security-policy` — CSP 建议

  **Acceptance Criteria**:
  - [ ] Dev 模式：CSP 允许 `'unsafe-eval'` 和 `ws://`
  - [ ] Prod 构建：CSP 严格（无 `'unsafe-eval'`，无 `ws://`）
  - [ ] Prod 构建中 `eval` 被阻止

  **QA Scenarios**:
  ```
  Scenario: 生产 CSP 严格
    Tool: Bash (grep)
    Steps:
      1. electron-vite build
      2. grep "Content-Security-Policy" out/renderer/index.html
      3. 断言不包含 'unsafe-eval'
      4. 断言不包含 'ws://'
    Expected Result: 生产构建 CSP 严格
    Evidence: .sisyphus/evidence/task-32-csp-prod.txt
  ```

  **Commit**: YES
  - Message: `security: add strict production CSP, permissive dev CSP`
  - Files: `src/renderer/index.html`

- [x] 33. 全量构建验证

  **What to do**:
  - 运行 `npm run build:electron`（electron-vite build + MCP + CLI）
  - 运行 `npx tsc --noEmit` 全量类型检查
  - 验证所有输出文件：
    - `out/main/index.js` — 可被 Node.js require
    - `out/preload/index.mjs` — 可被 Electron 加载
    - `out/renderer/index.html` — 有效 HTML 包含 `<script type="module">`
    - `dist/mcp-server.cjs` — 存在
    - `dist/cli.cjs` — 存在
  - 运行 `npm run test` — 所有 Vitest 测试通过
  - 验证 dev 模式：`npm run dev` 启动无错误

  **Must NOT do**:
  - 不跳过任何构建步骤

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖所有 Wave 4 和 Wave 5 任务）
  - **Parallel Group**: Wave 4 (final)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 28, Task 29, Task 30, Task 31, Task 32

  **Acceptance Criteria**:
  - [ ] `npm run build:electron` 退出码 0
  - [ ] `npx tsc --noEmit` 零错误
  - [ ] `npm run test` 所有测试通过
  - [ ] 所有 6 个输出文件存在
  - [ ] `npm run dev` 启动无错误

  **QA Scenarios**:
  ```
  Scenario: 全量构建
    Tool: Bash
    Steps:
      1. npm run build:electron 2>&1
      2. 断言退出码 0
      3. npx tsc --noEmit 2>&1
      4. 断言退出码 0
      5. ls out/main/index.js out/preload/index.mjs out/renderer/index.html dist/mcp-server.cjs dist/cli.cjs
      → 所有 5 个文件存在
    Expected Result: 全量构建零错误
    Evidence: .sisyphus/evidence/task-33-full-build.txt
  ```

  **Commit**: YES
  - Message: `build: verify full build pipeline`
  - Files: 验证后提交所有构建产物路径变更

---

- [x] 34. ConfigStore 单元测试

  **What to do**:
  - 创建 `src/renderer/src/stores/__tests__/config.test.ts`
  - TDD：先写 RED 测试，再确保 GREEN
  - 测试用例：
    1. 初始状态：空 store，所有字段为默认值
    2. `loadFromLocalStorage()`：localStorage 有预设值时，store 正确恢复
    3. `saveToLocalStorage()`：修改 store 字段后，localStorage 正确更新
    4. `saveToProject()`：Mock `window.moduleAgent.saveAgentConfig`，验证调用参数正确
    5. `loadFromProject()`：Mock `window.moduleAgent.getAgentConfig`，验证返回数据映射到 store
    6. Edge case：localStorage 损坏的 JSON → 优雅回退到默认值
  - 每个测试使用 `beforeEach` 清理 localStorage
  - 使用 `MockModuleAgentApi`（Task 7）

  **Must NOT do**:
  - 不测试 localStorage 内部实现
  - 不 mock Pinia 本身

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 7, Task 8

  **References**:
  - `src/renderer/src/stores/config.ts` — 被测试的 store
  - `src/renderer/src/__mocks__/moduleAgent.ts` — Mock API
  - `electron/renderer/renderer.ts:983-996` — 原 localStorage 恢复逻辑（验证一致性）

  **Acceptance Criteria**:
  - [ ] Test: RED → GREEN → 所有 6 个测试通过
  - [ ] `npx vitest run src/renderer/src/stores/__tests__/config.test.ts` 零失败

  **QA Scenarios**:
  ```
  Scenario: Config store 测试套件
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run src/renderer/src/stores/__tests__/config.test.ts
      2. 断言 6 个测试全部通过
    Expected Result: 所有 config store 测试通过
    Evidence: .sisyphus/evidence/task-34-config-test.txt
  ```

  **Commit**: YES
  - Message: `test: add ConfigStore TDD tests (6 scenarios)`
  - Files: `src/renderer/src/stores/__tests__/config.test.ts`

- [x] 35. AgentStore 单元测试

  **What to do**:
  - 创建 `src/renderer/src/stores/__tests__/agent.test.ts`
  - TDD：先写 RED 测试，再确保 GREEN
  - 测试用例：
    1. `startAgent()`：Mock `startAgent`，验证 store 更新
    2. `sendMessage()` 完整流程：start → send → stream → finish
    3. `cancelAgent()`：验证状态更新为 idle
    4. `stopAgent()`：验证 agent 从 runningAgents 移除
    5. Stream chunk 累积：mock stream 回调，验证 reply/thinking/tools 正确累积
    6. `saveStreamSnapshot()` / `restoreStreamSnapshot()` 往返
    7. Context `saveContext()` / `loadContext()` 往返
    8. Context pagination：12 条消息，验证 page 0 返回 5 条，page 1 返回 5 条，page 2 返回 2 条
    9. `refreshRunningAgents()`：Mock `getRunningAgents`，验证 Map 更新
    10. Cross-context 事件：验证追加到正确 moduleName 的 contextMap
  - 使用 `MockModuleAgentApi` 的 `triggerStream()` 和 `triggerCrossContext()` helpers

  **Must NOT do**:
  - 不测试真实的 IPC 调用

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 7, Task 10

  **References**:
  - `src/renderer/src/stores/agent.ts` — 被测试的 store
  - `src/renderer/src/__mocks__/moduleAgent.ts` — Mock API + trigger helpers

  **Acceptance Criteria**:
  - [ ] Test: RED → GREEN → 所有 10 个测试通过
  - [ ] `npx vitest run src/renderer/src/stores/__tests__/agent.test.ts` 零失败

  **QA Scenarios**:
  ```
  Scenario: Agent store 测试套件
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run src/renderer/src/stores/__tests__/agent.test.ts
      2. 断言 10 个测试全部通过
    Expected Result: 所有 agent store 测试通过
    Evidence: .sisyphus/evidence/task-35-agent-test.txt
  ```

  **Commit**: YES
  - Message: `test: add AgentStore TDD tests (10 scenarios)`
  - Files: `src/renderer/src/stores/__tests__/agent.test.ts`

- [x] 36. Stream composable 测试

  **What to do**:
  - 在 agent store 测试文件中（或独立文件 `stream.test.ts`）
  - 深度测试 stream 逻辑：
    1. Chunk 类型路由：`agent_message_chunk` → reply, `agent_thought_chunk` → thinking, `tool_call` → tools
    2. 多 chunk 累积：发送 3 个 message chunks，验证 reply 为拼接结果
    3. `finishStream()` thinking toggle 转换
    4. `cancelStream()`：验证状态重置
    5. Stream snapshot 防抖保存：验证 `scheduleStreamSave` 在 2 秒后触发
    6. 关闭 drawer 时 stream 继续缓冲：验证 streamState 不丢失

  **Must NOT do**:
  - 不测试真实的 WebSocket 或 IPC 连接

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 7, Task 10, Task 24

  **References**:
  - `electron/renderer/renderer.ts:739-761` — stream chunk 处理逻辑
  - `electron/renderer/renderer.ts:322-355` — finishStream thinking toggle 逻辑

  **Acceptance Criteria**:
  - [ ] Test: 所有 6 个 stream 测试通过
  - [ ] 每个 chunk 类型正确路由到对应 section

  **QA Scenarios**:
  ```
  Scenario: Stream composable 测试套件
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run --grep "stream" 2>&1
      2. 断言所有 stream 相关测试通过
    Expected Result: Stream 逻辑测试通过
    Evidence: .sisyphus/evidence/task-36-stream-test.txt
  ```

  **Commit**: YES
  - Message: `test: add stream composable TDD tests (6 scenarios)`
  - Files: stream 测试文件

- [x] 37. SVGTree 组件测试

  **What to do**:
  - 创建 `src/renderer/src/components/__tests__/SVGTree.test.ts`
  - 使用 `@vue/test-utils` 挂载组件
  - 测试用例：
    1. 渲染 2 层树：验证 `<rect>` 数量 = 节点数，`<path>` 数量 = 边数
    2. 点击节点 emit select 事件
    3. Click expand/collapse 按钮切换 visible 状态
    4. Pan 交互：模拟 mousedown + mousemove → transform 更新
    5. Zoom 交互：模拟 wheel → scale 在 0.3-2.5 范围内
    6. Agent 状态点：传入 runningAgents Map → 节点有正确 class（dot-idle/dot-streaming/dot-error）
    7. Active 节点高亮：selectedNode prop 匹配 → 对应 rect 有 `.active` class
    8. 空树：root 为 null → 无 child nodes（不崩溃）

  **Must NOT do**:
  - 不测试浏览器级别的 mousemove 行为（用 jsdom 模拟即可）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 15

  **References**:
  - `src/renderer/src/components/SVGTree.vue` — 被测试的组件
  - `electron/renderer/renderer.ts:924-978` — 原 renderSvg 逻辑（验证 SVG 结构一致）

  **Acceptance Criteria**:
  - [ ] Test: 所有 8 个测试通过
  - [ ] 组件在 jsdom 中正确渲染 SVG 元素

  **QA Scenarios**:
  ```
  Scenario: SVGTree 组件测试套件
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run src/renderer/src/components/__tests__/SVGTree.test.ts
      2. 断言 8 个测试全部通过
    Expected Result: SVGTree 组件测试通过
    Evidence: .sisyphus/evidence/task-37-tree-test.txt
  ```

  **Commit**: YES
  - Message: `test: add SVGTree component tests (8 scenarios)`
  - Files: `src/renderer/src/components/__tests__/SVGTree.test.ts`

- [x] 38. Playwright E2E 烟雾测试

  **What to do**:
  - 创建 `e2e/smoke.spec.ts`
  - 使用 Playwright + electron-vite 的 `electron` fixture（或手动启动 Electron）
  - E2E 测试流程：
    1. **启动应用** → setup 界面显示
    2. **表单填写** → fill agent cmd, workspace, project
    3. **浏览按钮** → mock 目录选择（或 skip dialog 验证）
    4. **开始扫描** → 点击按钮 → 等待 main 界面
    5. **SVG 树渲染** → 断言至少 3 个 rect 元素
    6. **点击节点** → 断言 drawer 打开
    7. **发送消息** → fill chat input, press Enter → 等待 stream
    8. **取消 stream** → 点击取消按钮 → 断言状态重置
    9. **设置对话框** → 打开 settings → 修改 agentCmd → 保存 → 验证
    10. **主题切换** → 点击 theme toggle → 验证 dark class 切换
    11. **Cross-context** → 触发 mock cross-context 事件 → 验证卡片出现
    12. **返回设置** → 点击 back FAB → 断言 setup 界面显示
  - 截图保存到 `.sisyphus/evidence/`

  **Must NOT do**:
  - 不在 E2E 中测试 IPC handler 内部逻辑（那是主进程的职责）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Task 24, Task 27（需要完整集成后的应用）

  **References**:
  - `electron/renderer/renderer.ts:860-894` — startScan 流程
  - `electron/renderer/renderer.ts:632-678` — sendContextMsg 流程
  - Playwright docs: `playwright.dev/docs/intro`

  **Acceptance Criteria**:
  - [ ] 12 个 E2E 测试全部通过
  - [ ] 截图证据保存到 `.sisyphus/evidence/`
  - [ ] `npx playwright test` 零失败

  **QA Scenarios**:
  ```
  Scenario: 完整用户流程
    Tool: Playwright
    Steps:
      1. 启动 Electron 应用
      2. 自动执行上述 12 个步骤
      3. 每个步骤截图
    Expected Result: 全流程无错误
    Evidence: .sisyphus/evidence/task-38-e2e-*.png (12 个截图)
  ```

  **Commit**: YES
  - Message: `test: add Playwright E2E smoke test (12 scenarios)`
  - Files: `e2e/smoke.spec.ts`, `playwright.config.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. Verify:
  - **Must Have**: All 13 preload IPC methods unchanged (diff against `electron/preload.ts`). All localStorage keys preserved. IPC channel names unchanged. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in BrowserWindow.
  - **Must NOT Have**: No new features (search, git validation, loading skeletons). No external tree libraries. No Element Plus components beyond allowed 11. No `@opentui/*` modifications. No `provide/inject` for IPC.
  - **Deliverables**: All 38 tasks checked. Evidence files in `.sisyphus/evidence/`.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit` + `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.log` in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Check Vue anti-patterns: `this.$refs` in Composition API, mutation outside Pinia actions.
  Output: `Build [PASS/FAIL] | TypeCheck [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Run the 12 Playwright E2E scenarios. Test cross-task integration (scan → tree → drawer → send → stream → context → settings → back). Test edge cases: empty project, single module, rapid message sends.
  Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 0** (1-4): Individual commits per task, sequential
- **Wave 1** (5-12): Individual commits per task, parallel-ready
- **Wave 2** (13-22): Individual commits per task, parallel-ready
- **Wave 3** (23-27): Individual commits per task, parallel-ready
- **Wave 4** (28-33): Individual commits per task, sequential within wave
- **Wave 5** (34-38): Individual commits per task, parallel-ready

**Commit message format**: `type(scope): description` — e.g., `feat: add SVGTree component`, `test: add ConfigStore TDD tests`

---

## Success Criteria

### Verification Commands
```bash
npm run build:electron     # Expected: all 5 builds pass, exit 0
npx tsc --noEmit           # Expected: zero errors
npm run test               # Expected: all vitest tests pass
npm run test:e2e           # Expected: all Playwright tests pass
npm run dev                # Expected: Vite dev server starts, Electron window opens
ls out/main/index.js out/preload/index.mjs out/renderer/index.html dist/mcp-server.cjs dist/cli.cjs
                           # Expected: all 5 output files exist
```

### Regression Checklist
- [ ] All 13 preload IPC method signatures unchanged (diff against `electron/preload.ts`)
- [ ] All localStorage keys unchanged (verify `ctx_`, `lastWorkspace`, `lastProject`, etc.)
- [ ] IPC channel names unchanged (`grep "ipcMain.handle" src/main/index.ts`)
- [ ] Main startup order preserved ("ModuleAgent starting..." then register then create)
- [ ] MCP backend starts after scan ("MCP setup complete: graph=... port=...")
- [ ] 3-second polling interval maintained
- [ ] `@opentui/*` dependencies untouched

### Functional Checklist
- [ ] Setup: form fills, browse buttons, scan button, error display
- [ ] Tree: SVG rendering, pan/zoom, collapse, select node, agent dots
- [ ] Drawer: open/close, resize, splitter, info display
- [ ] Stream: real-time thinking/tools/reply, cancel, snapshot persistence
- [ ] Context: chat history, pagination, thinking toggle, message detail modal
- [ ] Settings: save/load, project change triggers rescan
- [ ] Theme: dark/light toggle, persistence across restart
- [ ] Cross-context: events displayed in context cards

### Test Checklist
- [ ] ConfigStore: 6 tests pass (load, save, edge cases)
- [ ] AgentStore: 10 tests pass (stream, context, pagination, cross-context)
- [ ] Stream composable: 6 tests pass (chunk routing, finish, snapshot)
- [ ] SVGTree: 8 tests pass (render, events, pan/zoom, states)
- [ ] E2E: 12 smoke tests pass (full user flow)

