# TUI Tree Command — 模块树形图命令

## TL;DR

> **Quick Summary**: 为 TUI 模式新增 `/tree` 命令，以树状形式列出所有模块节点，显示名称、描述、路径及运行状态（● idle / ▶ streaming / ✗ error）。
> 
> **Deliverables**:
> - `getGraph()` 公开方法于 AgentService
> - `/tree` 命令实现（树形文本输出）
> - CommandPalette 命令注册 + `/help` 更新
> 
> **Estimated Effort**: Small
> **Parallel Execution**: YES — 3 tasks in 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3

---

## Context

### Original Request
TUI 模式新增命令 `tree`，以树状形式列出模块节点，并标出它们的信息、状态，可以参考 GUI 中的实现。

### Interview Summary
**Key Discussions**:
- **Status display**: 每个节点显示完整状态指示符（● idle / ▶ streaming / ✗ error），对标 GUI 行为
- **Node data**: 名称 + 描述 + 相对路径，每个节点三行信息
- **Command scope**: `/tree` 仅此一种，无参数，无过滤，始终从根节点显示完整树
- **Output**: 纯文本系统消息，渲染到聊天区域，无交互式展开/折叠
- **Test strategy**: Agent QA only（无单元测试），执行者构建后启动 TUI 直接验证

**Research Findings**:
- GUI 树实现: `electron/main.ts:545` 的 `buildTree()` 从 ModuleGraphNode 递归构建 TreeNode
- ModuleGraph 结构: `{ root: string, nodes: Map<string, ModuleGraphNode> }`，每个节点有 `parent` / `children[]`
- 状态来源: AgentService 当前仅追踪全局状态（`status: AgentStatus`），无逐模块状态
- Tree 字符: 标准 CLI 约定 `├──` / `└──` / `│`

### Metis Review
**Identified Gaps** (addressed):
- **Per-agent status tracking**: AgentService 当前仅追踪全局 `status`（当前 agent），非当前模块无法获取 streaming/error。**解决方案**: 当前 agent 使用 `AgentService.status`，其他已加载模块显示 ●（idle/loaded），未加载模块显示 ◌（not started）
- **Description truncation**: 描述过长会破坏树形对齐。**解决方案**: 截断至 40 字符 + `…`
- **Circular reference**: ModuleGraph.build() 无环检测。**解决方案**: 树遍历使用 `Set<string>` 追踪已访问节点
- **Empty graph/description**: 添加 null guard 和空描述处理 `(无描述)`
- **Tree character rendering**: 在 OpenTUI `<text>` 中 `├──` 应正常渲染（UTF-8 终端均支持）

---

## Work Objectives

### Core Objective
为 TUI 模式新增 `/tree` 命令，以 ASCII 树状图展示所有模块节点的层级结构、描述、路径和 Agent 运行状态。

### Concrete Deliverables
- `src/tui/services/AgentService.ts`: 新增 `getGraph()` 方法
- `src/tui/commands.ts`: `/tree` case + `/help` 条目更新
- `src/tui/components/CommandPalette.tsx`: `/tree` 注册到 COMMANDS 数组

### Definition of Done
- [ ] `npx tsc --noEmit` 通过，无类型错误
- [ ] 启动 TUI 后 `/tree` 输出树形模块结构
- [ ] 每个节点显示: 名称、描述（截断40字符）、路径、状态指示符
- [ ] CommandPalette 中可见 `/tree` 选项
- [ ] `/help` 输出包含 `/tree` 命令

### Must Have
- 从 `ModuleGraph` 根节点递归遍历所有模块
- 树形格式使用 `├──` / `└──` / `│` 字符
- 节点显示: 状态符号 + 名称 + 描述（≤40字符） + 路径
- 状态区分: 当前 streaming → ▶, 当前 error → ✗, 已加载 → ●, 未加载 → ◌
- 循环引用保护（visited Set）

### Must NOT Have (Guardrails)
- **NO** 交互式展开/折叠 — 纯静态文本输出
- **NO** 参数支持 — `/tree` 无 args, 无 `--running`, 无 `<subtree-root>`
- **NO** `workspacePath` 字段 — GUI 专有，TUI 路径未填充
- **NO** 修改 ContextArea 或新增 UI 组件 — 输出通过 addSystemMsg() 走现有渲染
- **NO** 修改 Electron/GUI 路径 — 仅 TUI
- **NO** 显示 `definition.body` 或 frontmatter 原始内容 — 仅 name/description/path

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (Agent QA only)
- **Framework**: N/A

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

- **TUI CLI**: Use `interactive_bash` (tmux) — launch TUI, send `/tree`, validate tree output content

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Add getGraph() to AgentService [quick]
├── Task 2: Add /tree case to commands.ts [quick]
└── Task 3: Register /tree in CommandPalette.tsx + /help update [quick]

Wave FINAL (After ALL tasks):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
└── Task F3: Real Manual QA (unspecified-high)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 3 → F1-F3
Max Concurrent: 3 (Wave 1 — all tasks independent)
```

### Dependency Matrix

- **1**: - - 2, 3
- **2**: 1 - -
- **3**: 1, 2 - -

### Agent Dispatch Summary

- **1**: **3** tasks — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **FINAL**: **3** tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`

---

## TODOs

- [x] 1. Add `getGraph()` method to AgentService

  **What to do**:
  - Open `src/tui/services/AgentService.ts`
  - Add two public methods after `listAgents()` (line 108):
    1. `getGraph(): ModuleGraphType | null` — returns `this.graph`
    2. `isModuleLoaded(name: string): boolean` — returns `this.entries.has(name)`
  - `getGraph()` exposes the `private graph` field for tree traversal
  - `isModuleLoaded()` exposes entry status for the status indicator (● vs ◌)
  - `ModuleGraphType` is already imported at line 9 — no new imports needed
  - Run `npx tsc --noEmit` to verify no type errors introduced

  **Must NOT do**:
  - Do NOT make `graph` or `entries` public fields — use methods for controlled access
  - Do NOT modify the graph structure or add any mutation methods
  - Do NOT change `listAgents()` or any other existing method

  **Recommended Agent Profile**:
  > This is a trivial single-file change with no logic — a simple method addition.
  - **Category**: `quick`
    - Reason: Single file, 3-line code addition, well-understood pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None — task too simple to need skills

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3 conceptually — but Task 2 depends on this method existing)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2 (needs getGraph() to exist before /tree can call it)
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL):

  **Existing code to follow (pattern reference)**:
  - `src/tui/services/AgentService.ts:106-108` — `listAgents()` method: same pattern (access this.graph, return data). Copy this structure exactly.
  - `src/tui/services/AgentService.ts:9` — `ModuleGraphType` import: already available, no need to add import
  - `src/types/module.ts:38-41` — `ModuleGraphType` interface: understand the return type

  **Acceptance Criteria**:
  - [ ] `getGraph()` method exists on AgentService class, returns `ModuleGraphType | null`
  - [ ] `isModuleLoaded(name)` method exists on AgentService class, returns `boolean`
  - [ ] `npx tsc --noEmit` passes with zero errors
  - [ ] `getGraph()` returns `null` when not initialized, graph data when ready

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Method exists and compiles
    Tool: Bash
    Steps:
      1. Run: npx tsc --noEmit
      2. Assert: exit code 0, no type errors in output
    Expected Result: TypeScript compilation passes
    Failure Indicators: Type errors mentioning getGraph or ModuleGraphType
    Evidence: .sisyphus/evidence/task-1-compile-check.txt

  Scenario: Method returns graph after init (integration)
    Tool: interactive_bash (tmux — TUI launch)
    Preconditions: Project initialized with module.md files
    Steps:
      1. Launch TUI: npm run build:electron && npm run electron
      2. Wait for TUI to load and agent to initialize
      3. Verify TUI shows "idle" status (graph loaded)
    Expected Result: TUI initializes without errors (proves graph is accessible internally)
    Failure Indicators: TUI fails to start, or "Agent 服务未就绪" appears at launch
    Evidence: .sisyphus/evidence/task-1-tui-starts.txt
  ```

  **Commit**: YES (groups with Tasks 2, 3)
  - Message: `feat(tui): add /tree command to show module tree with status`
  - Files: `src/tui/services/AgentService.ts`

- [x] 2. Add `/tree` case to commands.ts with tree formatting

  **What to do**:
  - Open `src/tui/commands.ts`
  - After the `/get` case (line 86, after `break;}`), add a new `/tree` case:
    1. Check `getAgentService()` not null — if null, `addSystemMsg('Agent 服务未就绪')` and return
    2. Call `service.getGraph()` — if returns null, same guard
    3. Build recursive tree string from graph: start at `graph.root`, walk `nodes.get(name).children`, using `visited` Set for cycle protection
    4. For each node, format: `[status] name — description [path]`
    5. Status rules: current agent AND streaming → `▶`; current AND error → `✗`; has entry in entries Map → `●`; else → `◌`
    6. Description: `node.definition.frontmatter.description.slice(0, 40) + (longer ? '…' : '')` — if empty, `(无描述)`
    7. Tree characters: `├── ` for intermediate children, `└── ` for last child, `│   ` for continuation lines
    8. Output full tree string via `addSystemMsg(treeString)`
  - Also update `/help` listing (line 26): add `/tree — 显示模块树形结构 (含状态)` between `/list` and `/get` lines

  **Must NOT do**:
  - Do NOT use `Array.find` for children lookup — use `graph.nodes.get(name)` for O(1) access
  - Do NOT recurse without visited tracking — infinite loop risk on circular references
  - Do NOT show `workspacePath` — TUI path doesn't populate this field
  - Do NOT show `definition.body` — only name/description/path
  - Do NOT add console.log statements — use `addSystemMsg` only

  **Recommended Agent Profile**:
  > Tree traversal with string formatting — straightforward logic but needs careful edge case handling.
  - **Category**: `quick`
    - Reason: Single file, well-defined algorithm (recursive tree walk), clear output format
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 for `getGraph()`)
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Task 3 (verification needs /tree to be functional)
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Existing command pattern to follow**:
  - `src/tui/commands.ts:38-62` — `/list` command: shows how to access `getAgentService()`, check for null, call service methods, format output, call `addSystemMsg()`
  - `src/tui/commands.ts:64-86` — `/get` command: shows argument validation pattern (reference, not used by /tree)

  **Tree building reference (GUI)**:
  - `electron/main.ts:545-554` — `buildTree()`: recursive tree construction from ModuleGraphNode. Follow this pattern but produce text instead of TreeNode objects.

  **Data structures**:
  - `src/types/module.ts:28-36` — `ModuleGraphNode`: fields used: `name`, `relativePath`, `children[]`, `definition`
  - `src/types/module.ts:38-41` — `ModuleGraph`: `root: string`, `nodes: Map<string, ModuleGraphNode>`
  - `src/tui/services/AgentService.ts:98-99` — `getCurrentAgent()`: to identify current agent for status
  - `src/tui/services/AgentService.ts:102-104` — `getAgentStatus()`: current agent's global status (streaming/idle/error)
  - `src/tui/services/AgentService.ts:22` — `entries: Map<string, AgentEntry>`: check if module has loaded agent (private, but `getGraph()` can be extended or service can expose loaded modules)

  **Agent status lookup**:
  - `src/tui/services/AgentService.ts:98-99` — `getCurrentAgent(): string` — compare against node name
  - `src/tui/services/AgentService.ts:102-104` — `getAgentStatus(): AgentStatus` — use for current agent status
  - `src/tui/services/AgentService.ts` (new method) — `isModuleLoaded(name: string): boolean` — check if module has a started agent entry

  **WHY Each Reference Matters**:
  - `/list` command: exact pattern for service access + null guard + output formatting — copy the guard structure
  - `buildTree()` in main.ts: the recursive traversal algorithm to replicate — replace TreeNode construction with string concatenation
  - `ModuleGraphNode` type: know which fields are available and safe to display
  - `AgentService.getCurrentAgent()` + `getAgentStatus()`: only way to determine streaming/error status in TUI path

  **Acceptance Criteria**:
  - [ ] `/tree` case exists in `executeCommand()` switch statement
  - [ ] Tree walks from graph.root using children[]
  - [ ] `visited` Set prevents infinite recursion on cycles
  - [ ] Status indicators: ▶ for streaming current, ✗ for error current, ● for loaded, ◌ for unloaded
  - [ ] Descriptions truncated to 40 characters with `…` suffix when longer
  - [ ] Empty descriptions show `(无描述)`
  - [ ] `npx tsc --noEmit` passes with zero errors
  - [ ] `/help` output includes `/tree` entry

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: /tree shows full module tree in a real initialized project
    Tool: interactive_bash (tmux)
    Preconditions: Project has root module.md + at least one submodule
    Steps:
      1. Launch TUI: npm run build:electron && npm run electron
      2. Wait for "agent: idle" status in status bar (graph initialized)
      3. Send keystrokes: "/tree"
      4. Send keystroke: Enter
      5. Capture terminal output
    Expected Result: Tree output shows root node at top, child nodes indented with ├──/└──, each node has name, description, path, status indicator
    Failure Indicators: "Agent 服务未就绪" message, blank output, "未找到模块" error, incorrectly nested tree characters
    Evidence: .sisyphus/evidence/task-2-tree-output.txt

  Scenario: /tree with only root node (no children)
    Tool: interactive_bash (tmux)
    Preconditions: Project with only root module.md, no submodules declared
    Steps:
      1. Launch TUI in minimal project
      2. Type /tree, hit Enter
    Expected Result: Single root node displayed with status indicator, no ├──/└── characters (no children)
    Failure Indicators: Crash, error message, or tree characters appearing for nonexistent children
    Evidence: .sisyphus/evidence/task-2-single-node.txt

  Scenario: /tree with circular module references
    Tool: interactive_bash (tmux)
    Preconditions: Manually create module A referencing B, module B referencing A (circular)
    Steps:
      1. Launch TUI in project with circular modules
      2. Type /tree, hit Enter
    Expected Result: Tree terminates normally without infinite recursion or hang. Each module appears once.
    Failure Indicators: TUI hangs, output never completes, stack overflow crash
    Evidence: .sisyphus/evidence/task-2-circular-safe.txt

  Scenario: /tree when agent service is not ready
    Tool: interactive_bash (tmux)
    Preconditions: Launch TUI but prevent agent initialization (e.g., invalid config)
    Steps:
      1. Launch TUI in a non-project directory (no .module-agent.json)
      2. Type /tree, hit Enter before initialization completes
    Expected Result: "Agent 服务未就绪" system message
    Failure Indicators: Crash, null reference error in terminal
    Evidence: .sisyphus/evidence/task-2-not-ready.txt
  ```

  **Evidence to Capture**:
  - [ ] Each evidence file named as specified above
  - [ ] Terminal output captures for all scenarios

  **Commit**: YES (groups with Tasks 1, 3)
  - Message: `feat(tui): add /tree command to show module tree with status`
  - Files: `src/tui/commands.ts`

- [x] 3. Register `/tree` in CommandPalette and update /help

  **What to do**:
  - Open `src/tui/components/CommandPalette.tsx`
  - Add to the `COMMANDS` array (after `/get` entry, before `/mode` entry, around line 15):
    ```typescript
    { name: "/tree", description: "显示模块树形结构及状态" },
    ```
  - Open `src/tui/commands.ts`
  - In the `/help` case (line 26), add: `/tree — 显示模块树形结构 (含状态)` — place between `/list` and `/get` entries for logical grouping
  - Verify the full `/help` output includes all 8 commands including `/tree`

  **Must NOT do**:
  - Do NOT change the existing command ordering logic in CommandPalette — just insert the new entry
  - Do NOT modify the `useKeyboard` logic or any behavior other than the COMMANDS array
  - Do NOT add `/tree` to any other file beyond these two locations

  **Recommended Agent Profile**:
  > Trivial additions to two static arrays — pure data entry.
  - **Category**: `quick`
    - Reason: Two files, adding one array entry each, zero logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2 if /tree case already exists; but conceptually after Task 2)
  - **Parallel Group**: Wave 1 (can run in parallel with Task 2 since they touch different files)
  - **Blocks**: None
  - **Blocked By**: Task 1 (for conceptual completeness, though technically independent)

  **References** (CRITICAL):

  **Existing COMMANDS array pattern**:
  - `src/tui/components/CommandPalette.tsx:11-19` — existing COMMANDS entries: add new entry matching this format exactly

  **Existing /help pattern**:
  - `src/tui/commands.ts:26-33` — `/help` listing: follow the `'/name — 描述'` format used by existing entries

  **Acceptance Criteria**:
  - [ ] `/tree` entry present in CommandPalette COMMANDS array
  - [ ] `/tree` line present in `/help` system message output
  - [ ] `npx tsc --noEmit` passes with zero errors
  - [ ] CommandPalette shows `/tree` when user types `/t` in TUI input

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: /tree appears in command palette
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Type "/t" (partial match for /tree)
      3. Observe command palette popup
    Expected Result: Command palette shows "/tree  显示模块树形结构及状态" as one of the filtered options
    Failure Indicators: /tree not visible in palette, wrong description text
    Evidence: .sisyphus/evidence/task-3-palette.txt

  Scenario: /help lists /tree
    Tool: interactive_bash (tmux)
    Steps:
      1. Launch TUI
      2. Type /help, hit Enter
      3. Observe system message
    Expected Result: System message includes "/tree — 显示模块树形结构 (含状态)" line
    Failure Indicators: /tree missing from help output
    Evidence: .sisyphus/evidence/task-3-help.txt
  ```

  **Evidence to Capture**:
  - [ ] Command palette screenshot showing /tree entry
  - [ ] Help output showing /tree line

  **Commit**: YES (groups with Tasks 1, 2)
  - Message: `feat(tui): add /tree command to show module tree with status`
  - Files: `src/tui/components/CommandPalette.tsx`, `src/tui/commands.ts`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Build and launch TUI. Execute EVERY QA scenario from every task. Test cross-task integration (command palette + tree output + help listing). Test edge cases: empty graph, single node, deep tree, status indicators. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

---

## Commit Strategy

- **1**: `feat(tui): add /tree command to show module tree with status` — commands.ts, CommandPalette.tsx, AgentService.ts

---

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit    # Expected: zero errors
npm run build:electron && npm run electron  # Expected: TUI launches, /tree works
```

### Final Checklist
- [ ] All "Must Have" present (tree traversal, format, status, cycle protection)
- [ ] All "Must NOT Have" absent (no args, no UI components, no GUI changes)
- [ ] `npx tsc --noEmit` passes
