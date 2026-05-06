# Unify Project Path Configuration

## TL;DR

> **Quick Summary**: Replace 3 separate config fields (`modulesPath`, `workspace.path`, `codeSource`) with a single `projectPath` field. Auto-derive `.module-agent/module/` (module scan dir) and `.module-agent/workspace/` (workspace isolation dir) from `projectPath`. Remove `codeSource` object entirely. No backward compatibility.
>
> **Deliverables**:
> - Updated Zod schema and TypeScript interfaces with `projectPath` field
> - Updated `ConfigLoader` with old config rejection
> - Updated all consumers: Electron main, CLI, TUI, renderer stores/views
> - Simplified `WorkspaceIsolator` (remove git code, remove codeSource param)
> - Simplified `AgentOrchestrator` and `AgentManager` (remove codeSource propagation)
> - Updated preload bridge, types, and mocks
> - Updated documentation and sample config
> - New unit tests for schema, defaults, and ConfigLoader (TDD)
>
> **Estimated Effort**: Large (21 tasks across 5 waves + final verification)
> **Parallel Execution**: YES - 5 waves with high parallelism in Waves 2-5
> **Critical Path**: Wave 1 (tests) → Wave 2 (core config) → Wave 3 (backend consumers) → Wave FINAL

---

## Context

### Original Request

User wants to unify three separate config settings (`modulesPath`, `workspace.path`, `codeSource.path`) into a single `projectPath` field. When `projectPath` is configured, `.module-agent/module/` and `.module-agent/workspace/` subdirectories are auto-created and used as the module directory and workspace directory respectively.

### Interview Summary

**Key Discussions**:
- **Field name**: `projectPath` (matches existing `workspace.path` naming convention)
- **Merge scope**: ALL three path fields (`modulesPath` + `workspace.path` + `codeSource.path`) → single `projectPath`
- **Remove `codeSource` entirely**: type, url, branch, path all deleted
- **No backward compatibility**: Old fields deleted, no migration, old configs silently fall back to defaults
- **Renderer unification**: Also unify renderer's localStorage `workspacePath`/`projectPath` into single `projectPath`
- **Test strategy**: TDD - write tests before implementation
- **Auto-create**: `.module-agent/module/` and `.module-agent/workspace/` directories
- **`projectPath` field is REQUIRED** in the config (not optional)

**Research Findings**:
- 14 source files reference `modulesPath`, 28+ reference `workspace.path`
- Two parallel code paths (Electron + CLI/TUI) use identical module scanning logic
- `workspace.path` is effectively orphaned in Electron path - main process never reads it from config
- `codeSource` drives `prepareModuleWorkspace()` (130 lines) and `resolveGitCodeSource()` (97 lines)
- `src/config/` has ZERO direct tests - must write test infrastructure from scratch
- Renderer has separate localStorage fields that predate the config split

### Metis Review

**Identified Gaps** (addressed):
- **Old config behavior**: Old `.module-agent.json` files will fail Zod validation → `ConfigLoader.load()` silently falls back to defaults. This is acceptable per user's "no backward compatibility" decision. We document this clearly.
- **`projectRoot` vs `projectPath` naming**: `projectRoot` in the codebase means "directory where `.module-agent.json` exists". `projectPath` is the new config field. They should ALWAYS be the same value. ConfigLoader validates this and logs a warning if they differ.
- **`prepareModuleWorkspace()` fallbacks**: All 5 graceful fallback paths MUST be preserved. Simplified source resolution but error paths unchanged.
- **Scope creep prevention**: Renderer localStorage unification bundled in same plan but as a dedicated wave.
- **Workspace naming**: Use `.module-agent/workspace/` (matching user's request) not `.module-agent/workspaces/` (old default).

---

## Work Objectives

### Core Objective

Replace `modulesPath`, `workspace.path`, and the entire `codeSource` object with a single `projectPath: string` config field. Auto-derive `.module-agent/module/` and `.module-agent/workspace/` subdirectories. Simplify WorkspaceIsolator by removing git code. Unify renderer's scattered localStorage path fields.

### Concrete Deliverables

- `src/config/schema.ts` — Updated Zod schema with `projectPath`
- `src/config/defaults.ts` — Updated interfaces and defaults
- `src/config/ConfigLoader.ts` — Removed legacy migration, added projectPath validation
- `src/config/__tests__/` — New test files (schema, defaults, loader)
- `src/main/index.ts` — Updated `project:scan`, `config:save`, `config:get`
- `src/cli/commands/setup.ts` — Simplified setup flow
- `src/tui/config.ts` — Updated config writing
- `src/tui/services/AgentService.ts` — Simplified module scanning
- `src/tui/components/SetupWizard.tsx` — Reduced steps
- `src/tui/renderer.tsx` — Updated validation check
- `src/agents/WorkspaceIsolator.ts` — Removed `codeSource` param, git code
- `src/agents/AgentOrchestrator.ts` — Removed `codeSource` propagation
- `src/agents/AgentManager.ts` — Removed `codeSource` field
- `src/preload/index.ts` — Updated IPC bridge
- `src/types/preload.ts` — Updated type signatures
- `src/renderer/src/stores/config.ts` — Unified localStorage fields
- `src/renderer/src/views/SetupView.vue` — Simplified form
- `src/renderer/src/views/MainView.vue` — Updated scan call
- `src/renderer/src/components/SettingsDialog.vue` — Simplified form
- `src/renderer/src/components/DrawerPanel.vue` — Updated CWD logic
- `src/renderer/src/__mocks__/moduleAgent.ts` — Updated mock signatures
- `AGENTS.md`, `CLAUDE.md`, `docs/DESIGN.md`, `docs/MODULE_FORMAT.md` — Updated docs
- `.module-agent.json` — Updated sample config

### Definition of Done

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run test` passes (all new + existing tests)
- [ ] `npm run test:e2e` smoke test passes
- [ ] All 5 graceful fallbacks in `prepareModuleWorkspace()` preserved
- [ ] Module scanning finds modules from both `projectPath` and `projectPath/.module-agent/module/`
- [ ] Old `.module-agent.json` files cause clear Zod validation error (not silent corruption)
- [ ] `.module-agent/module/` and `.module-agent/workspace/` auto-created on first scan

### Must Have

- `projectPath` is a REQUIRED string in Zod schema (not optional)
- `codeSource` object COMPLETELY removed from schema, types, defaults, and all consumers
- `WorkspaceIsolator.resolveGitCodeSource()` removed entirely
- All `normalizeCodeSourcePath()` calls for old fields replaced with direct `projectPath` usage
- `prepareModuleWorkspace()` 5 fallback paths preserved
- Sub-module exclusion logic in `prepareModuleWorkspace()` preserved

### Must NOT Have (Guardrails)

- Do NOT modify `ModuleScanner.scan()`, `ModuleGraph.build()`, or `ModuleParser` APIs
- Do NOT change the `exclude` field behavior or validation
- Do NOT remove `simple-git` dependency (may have other consumers)
- Do NOT change agent command/args config (`agents.default`, `agents.modules`)
- Do NOT remove any `module.md` auto-generation logic in CLI setup
- Do NOT change the `.module-agent.json` file location or loading mechanism

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: TDD
- **Framework**: Vitest v4.1.5

### QA Policy

Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright - Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **Library/Module**: Use Bash (bun/node REPL) - Import, call functions, compare output
- **CLI**: Use interactive_bash (tmux) - Run command, send keystrokes, validate output

---

## Execution Strategy

### Design Decisions (from Metis review)

1. **`projectPath` = config file location**: The `projectPath` field SHOULD be the same directory where `.module-agent.json` lives. ConfigLoader validates this and logs a warning if they differ. The field exists for explicitness (config file self-documents its project location).

2. **Old config silent fallback**: When an old `.module-agent.json` is detected, Zod validation fails on unknown fields (`codeSource`, `modulesPath`, `workspace`). `ConfigLoader.load()` falls back to `DEFAULT_WORKSPACE_CONFIG` with a warning log. No auto-migration. This is documented.

3. **Module scanning dual-source preserved**: Module scanning scans BOTH `projectPath` (for source-tree `module.md` files) AND `projectPath/.module-agent/module/` (for additional external `module.md` files). Results are merged with deduplication.

4. **WorkspaceIsolator simplification**: `codeSourcePathForModule()` uses `projectPath` directly as the source root. `resolveGitCodeSource()` is deleted. `prepareModuleWorkspace()` uses `projectPath/.module-agent/workspace/` as the dest root. All 5 fallback paths preserved.

5. **Renderer localStorage migration**: `configStore` replaces `workspacePath` + `projectPath` refs with single `projectPath`. Old localStorage keys are read once for migration, then new single key is used. SetupView removes workspace path UI, SettingsDialog removes workspace path input.

### Parallel Execution Waves

```
Wave 1 (Start Immediately - TDD test foundation, sequential internally):
├── Task 1: Create schema tests for projectPath [quick]
├── Task 2: Create defaults tests [quick]
└── Task 3: Create ConfigLoader tests [quick]

Wave 2 (After Wave 1 - Core config implementation, MAX PARALLEL):
├── Task 4: Update schema.ts [quick]
├── Task 5: Update defaults.ts [quick]
└── Task 6: Update ConfigLoader.ts [quick]

Wave 3 (After Wave 2 - Backend consumers, HIGH PARALLELISM):
├── Task 7: Update Electron main/index.ts [unspecified-high]
├── Task 8: Update CLI setup.ts [quick]
├── Task 9: Update TUI AgentService + config + renderer [unspecified-high]
├── Task 10: Update TUI SetupWizard.tsx [quick]
├── Task 11: Simplify WorkspaceIsolator.ts [deep]
├── Task 12: Update AgentOrchestrator + AgentManager [quick]
├── Task 13: Update preload types + index [quick]
└── Task 14: Update renderer mocks [quick]

Wave 4 (After Wave 3 - Renderer UI, HIGH PARALLELISM):
├── Task 15: Unify configStore localStorage fields [unspecified-high]
├── Task 16: Update SetupView.vue [visual-engineering]
├── Task 17: Update SettingsDialog.vue [visual-engineering]
├── Task 18: Update MainView.vue [quick]
└── Task 19: Update DrawerPanel.vue [quick]

Wave 5 (After Wave 4 - Documentation + sample, MAX PARALLEL):
├── Task 20: Update AGENTS.md + CLAUDE.md [quick]
├── Task 21: Update docs/DESIGN.md + MODULE_FORMAT.md [quick]
└── Task 22: Update .module-agent.json sample [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 3 → Task 4-6 → Task 7 → Task 11 → Task 15 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 8 (Wave 3)
```

### Agent Dispatch Summary

- **Wave 1**: 3 × `quick` — T1-T3
- **Wave 2**: 3 × `quick` — T4-T6
- **Wave 3**: 8 agents — T7(`unspecified-high`), T8(`quick`), T9(`unspecified-high`), T10(`quick`), T11(`deep`), T12(`quick`), T13(`quick`), T14(`quick`)
- **Wave 4**: 5 agents — T15(`unspecified-high`), T16(`visual-engineering`), T17(`visual-engineering`), T18(`quick`), T19(`quick`)
- **Wave 5**: 3 × `quick` — T20-T22
- **FINAL**: 4 — F1(`oracle`), F2(`unspecified-high`), F3(`unspecified-high`), F4(`deep`)

---

## TODOs

- [x] 1. Create Zod schema tests for `projectPath` field

  **What to do**:
  - Create `src/config/__tests__/schema.test.ts`
  - Test `ProjectConfigSchema` with NEW format: `{ projectPath: "/test/proj", agents: {...}, exclude: [] }` → valid
  - Test `ProjectConfigSchema` with OLD fields: `{ codeSource: {...}, modulesPath: "...", workspace: {...} }` → should FAIL validation on unknown keys
  - Test `projectPath` as required: `{ agents: {...}, exclude: [] }` without `projectPath` → should FAIL
  - Test `projectPath` type: `{ projectPath: 123 }` (non-string) → should FAIL
  - Test `ConfigEntrySchema` extends correctly with `name` field
  - Test `WorkspaceConfigSchema` wraps `configs[]` array correctly
  - Follow existing test patterns: `import { describe, it, expect } from 'vitest'`, no mocks needed
  - Use `safeParse()` to check success/error without throwing

  **Must NOT do**:
  - Do NOT import or test the old `ProjectConfigSchema` format (that's being deleted)
  - Do NOT test ConfigLoader behavior (separate test file)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward test file creation, no dependencies, pure validation logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None relevant

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential - must complete before Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2, Task 3 (subsequent test files should follow this pattern)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/config/schema.ts` - Current Zod schemas to understand structure (read-only, to design tests for new schema)
  - `src/config/defaults.ts:36-53` - DEFAULT_CONFIG_ENTRY to understand expected field structure
  - `src/renderer/src/stores/__tests__/config.test.ts` - Example test patterns (describe/it/expect from vitest)

  **Acceptance Criteria**:
  - [ ] Test file created: `src/config/__tests__/schema.test.ts`
  - [ ] `npm run test src/config/__tests__/schema.test.ts` → ALL FAIL (RED phase - new schema not yet implemented)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: New format with projectPath validates successfully
    Tool: Bash (bun)
    Preconditions: Test file exists, old schema still active
    Steps:
      1. Run: npx vitest run src/config/__tests__/schema.test.ts
      2. Assert: Tests for new schema format FAIL (because schema.ts still has old fields)
      3. Assert: Error messages mention "projectPath" (not "codeSource" or "modulesPath")
    Expected Result: Tests fail with clear messages showing new schema expectations
    Failure Indicators: Tests pass (old schema still matches expectations) or error messages reference old field names
    Evidence: .sisyphus/evidence/task-1-schema-red.txt

  Scenario: Old format with codeSource/modulesPath/workspace is rejected
    Tool: Bash (bun)
    Preconditions: same as above
    Steps:
      1. The test should define an old-format config object with codeSource, modulesPath, workspace.path
      2. Run safeParse on it
      3. Assert: result.success === false
    Expected Result: Old format rejected by schema validation
    Evidence: .sisyphus/evidence/task-1-old-rejected.txt
  ```

  **Commit**: YES (groups with Tasks 2-3)
  - Message: `test(config): add schema, defaults, and loader tests for projectPath`
  - Files: `src/config/__tests__/schema.test.ts`

- [x] 2. Create defaults tests for `projectPath`

  **What to do**:
  - Create `src/config/__tests__/defaults.test.ts`
  - Test `DEFAULT_CONFIG_ENTRY.projectPath` is defined and non-empty
  - Test `DEFAULT_WORKSPACE_CONFIG` wraps entry correctly with `defaultConfig: "default"`
  - Test `DEFAULT_CONFIG === DEFAULT_CONFIG_ENTRY` (backward compat alias)
  - Test `DEFAULT_CONFIG_ENTRY` can be parsed by `ProjectConfigSchema` (when new schema is implemented)
  - Verify old fields are NOT present: `codeSource`, `modulesPath`, `workspace` should be undefined
  - Follow same test patterns as Task 1

  **Must NOT do**:
  - Do NOT test ConfigLoader behavior (separate test file)
  - Do NOT import old `ProjectConfig` interface if it still has old fields

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple assertions against exported constants
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3, after Task 1 completes)
  - **Parallel Group**: Wave 1 (with Task 3)
  - **Blocks**: Task 5 (defaults.ts implementation)
  - **Blocked By**: Task 1 (test patterns established)

  **References**:
  - `src/config/defaults.ts` - Current defaults to understand structure
  - `src/config/__tests__/schema.test.ts` - Pattern reference (Task 1 output)

  **Acceptance Criteria**:
  - [ ] Test file created: `src/config/__tests__/defaults.test.ts`
  - [ ] `npm run test src/config/__tests__/defaults.test.ts` → ALL FAIL (RED phase)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: DEFAULT_CONFIG_ENTRY has projectPath field
    Tool: Bash (bun)
    Preconditions: Test file exists
    Steps:
      1. Run: npx vitest run src/config/__tests__/defaults.test.ts
      2. Assert: Tests fail because DEFAULT_CONFIG_ENTRY still has old fields
    Expected Result: Tests fail with expectations about projectPath field
    Evidence: .sisyphus/evidence/task-2-defaults-red.txt
  ```

  **Commit**: YES (groups with Tasks 1, 3)
  - Message: `test(config): add schema, defaults, and loader tests for projectPath`
  - Files: `src/config/__tests__/defaults.test.ts`

- [x] 3. Create ConfigLoader tests for new behavior

  **What to do**:
  - Create `src/config/__tests__/ConfigLoader.test.ts`
  - Test: `load()` with valid new-format config → returns parsed `WorkspaceConfig` with `projectPath`
  - Test: `load()` with old-format config (has `codeSource`, `modulesPath`) → falls back to `DEFAULT_WORKSPACE_CONFIG` + logs warning
  - Test: `load()` with no config file → returns `DEFAULT_WORKSPACE_CONFIG`
  - Test: `load()` with invalid JSON → falls back to defaults
  - Test: `loadOrCreate()` with no config file → creates file with defaults + returns defaults
  - Test: `getDefaultConfig()` finds entry by `defaultConfig` name
  - Test: `getDefaultConfig()` fallback to first entry when name not found
  - Mock strategy: Use `vi.mock('fs-extra')` to simulate filesystem (follow existing vitest patterns)
  - Use `vi.spyOn()` pattern for logger warnings

  **Must NOT do**:
  - Do NOT test the legacy migration path (it's being removed)
  - Do NOT use real filesystem - always mock `fs-extra`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test file creation with standard vitest mocking
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2, after Task 1 completes)
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 6 (ConfigLoader.ts implementation)
  - **Blocked By**: Task 1 (test patterns established)

  **References**:
  - `src/config/ConfigLoader.ts` - Current ConfigLoader to understand methods and behavior
  - `src/config/schema.ts` - Schema used by ConfigLoader
  - `src/renderer/src/stores/__tests__/config.test.ts:20-30` - Example mock pattern using `vi.fn()`

  **Acceptance Criteria**:
  - [ ] Test file created: `src/config/__tests__/ConfigLoader.test.ts`
  - [ ] `npm run test src/config/__tests__/ConfigLoader.test.ts` → ALL FAIL (RED phase)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: New format config loads successfully
    Tool: Bash (bun)
    Preconditions: Test file with mocked fs-extra
    Steps:
      1. Run: npx vitest run src/config/__tests__/ConfigLoader.test.ts
      2. Assert: Tests fail (ConfigLoader still expects old schema format)
    Expected Result: Tests fail with clear assertions about expected behavior
    Evidence: .sisyphus/evidence/task-3-loader-red.txt
  ```

  **Commit**: YES (groups with Tasks 1-3)
  - Message: `test(config): add schema, defaults, and loader tests for projectPath`
  - Files: `src/config/__tests__/ConfigLoader.test.ts`

- [x] 4. Update schema.ts - replace old fields with `projectPath`

  **What to do**:
  - Edit `src/config/schema.ts`
  - Replace `CodeSourceSchema` (lines 8-13) with nothing — DELETE entire schema
  - In `ProjectConfigSchema` (lines 16-27):
    - Remove `workspace: z.object({ path: z.string() })` (lines 22-24)
    - Remove `codeSource: CodeSourceSchema` (line 25)
    - Remove `modulesPath: z.string().optional()` (line 26)
    - Add `projectPath: z.string()` (required, non-optional)
  - Updated `ProjectConfigSchema` should be:
    ```ts
    export const ProjectConfigSchema = z.object({
      agents: z.object({
        default: AgentConfigSchema,
        modules: z.record(z.string(), AgentConfigSchema).optional(),
      }),
      exclude: z.array(z.string()),
      projectPath: z.string(),
    });
    ```
  - Remove `CodeSourceSchema` export (line 8-13) entirely
  - Keep `AgentConfigSchema`, `ConfigEntrySchema`, `WorkspaceConfigSchema` unchanged
  - Verify: old tests fail on OLD schema validation (expected - tests were written for new schema)

  **Must NOT do**:
  - Do NOT modify `AgentConfigSchema` or `WorkspaceConfigSchema`
  - Do NOT keep any deprecated aliases or optional fields

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file edit, clear replacement
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: All Wave 3+ tasks (everything depends on schema)
  - **Blocked By**: Tasks 1-3 (tests must be written first)

  **References**:
  - `src/config/schema.ts` - File to edit (read before editing)
  - `src/config/__tests__/schema.test.ts` - Test expectations to satisfy (from Task 1)

  **Acceptance Criteria**:
  - [ ] `CodeSourceSchema` removed from schema.ts
  - [ ] `projectPath: z.string()` added to `ProjectConfigSchema`
  - [ ] `modulesPath`, `workspace`, `codeSource` removed from `ProjectConfigSchema`
  - [ ] `npm run test src/config/__tests__/schema.test.ts` → PASS (GREEN phase)
  - [ ] `npm run typecheck` — may fail due to other files still referencing old fields (expected, fixed in later tasks)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Schema tests pass after implementation
    Tool: Bash (bun)
    Preconditions: Task 1 tests exist
    Steps:
      1. Run: npx vitest run src/config/__tests__/schema.test.ts
      2. Assert: All tests PASS
      3. Assert: Zero test failures
    Expected Result: Green - all schema validation tests pass
    Evidence: .sisyphus/evidence/task-4-schema-green.txt

  Scenario: Old format rejection
    Tool: Bash (bun)
    Steps:
      1. Use node REPL or test to import ProjectConfigSchema
      2. Parse old format: { codeSource: {type:'local',path:'/x'}, workspace:{path:'/y'} }
      3. Assert: safeParse fails with error about unknown keys "codeSource", "workspace"
    Expected Result: Old config rejected with clear error
    Evidence: .sisyphus/evidence/task-4-old-rejected.txt
  ```

  **Commit**: YES (groups with Tasks 5-6)
  - Message: `feat(config): replace modulesPath/workspace/codeSource with projectPath`
  - Files: `src/config/schema.ts`

- [x] 5. Update defaults.ts - update types and defaults

  **What to do**:
  - Edit `src/config/defaults.ts`
  - Remove `CodeSourceConfig` interface (lines 1-6) entirely
  - In `ProjectConfig` interface (lines 8-25):
    - Remove `workspace: { path: string }` (lines 20-22)
    - Remove `codeSource: CodeSourceConfig` (line 23)
    - Remove `modulesPath?: string` (line 24)
    - Add `projectPath: string`
  - Remove `CodeSourceConfig` from exports
  - In `DEFAULT_CONFIG_ENTRY` (lines 36-53):
    - Remove `workspace: { path: '.module-agent/workspaces' }` (lines 45-47)
    - Remove `codeSource: { type: 'local', path: '' }` (lines 48-51)
    - Remove `modulesPath: ''` (line 52)
    - Add `projectPath: '.'` (current directory as sensible default)
  - Update `ConfigEntry` and `WorkspaceConfig` interfaces if needed

  **Must NOT do**:
  - Do NOT remove `DEFAULT_CONFIG` backward compat alias (line 61)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type/constant edits in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8 (CLI setup uses DEFAULT_CONFIG_ENTRY), all Wave 3+ consumers
  - **Blocked By**: Task 2 (tests)

  **References**:
  - `src/config/defaults.ts` - File to edit
  - `src/config/__tests__/defaults.test.ts` - Test expectations (Task 2)

  **Acceptance Criteria**:
  - [ ] `CodeSourceConfig` interface removed
  - [ ] `projectPath: string` in `ProjectConfig` interface
  - [ ] `projectPath: '.'` in `DEFAULT_CONFIG_ENTRY`
  - [ ] `npm run test src/config/__tests__/defaults.test.ts` → PASS (GREEN phase)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Defaults tests pass after implementation
    Tool: Bash (bun)
    Steps:
      1. Run: npx vitest run src/config/__tests__/defaults.test.ts
      2. Assert: All tests PASS
    Expected Result: Green - all defaults tests pass
    Evidence: .sisyphus/evidence/task-5-defaults-green.txt
  ```

  **Commit**: YES (groups with Tasks 4, 6)
  - Message: `feat(config): replace modulesPath/workspace/codeSource with projectPath`
  - Files: `src/config/defaults.ts`

- [x] 6. Update ConfigLoader.ts - remove migration, add validation

  **What to do**:
  - Edit `src/config/ConfigLoader.ts`
  - Remove `migrateLegacyConfig()` function (lines 7-14) — no longer needed
  - Remove legacy fallback code in `load()` (lines 35-46: `safeParse` with `ProjectConfigSchema`, migration logic, `writeJson`)
  - Simplify `load()` to:
    1. Read config file (or return defaults if missing)
    2. Parse with `WorkspaceConfigSchema.safeParse()`
    3. If parse fails → log warning + return defaults (DO NOT attempt legacy migration)
    4. If parse succeeds → return result
  - Add `projectPath` consistency check (optional warning):
    - After loading, compare `projectPath` field with the directory containing `.module-agent.json` (the `projectRoot` argument)
    - If they differ, log a warning: `[config] projectPath in config differs from config file location`
  - Do NOT auto-fix or auto-migrate - just warn
  - Update `loadOrCreate()` to use new defaults

  **Must NOT do**:
  - Do NOT add migration logic for old configs
  - Do NOT auto-write the config file on load

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file simplification, removing code paths
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: All Wave 3+ consumers that call ConfigLoader
  - **Blocked By**: Tasks 3 (tests), 4 (schema), 5 (defaults)

  **References**:
  - `src/config/ConfigLoader.ts` - File to edit
  - `src/config/__tests__/ConfigLoader.test.ts` - Test expectations (Task 3)
  - `src/config/defaults.ts` - DEFAULT_WORKSPACE_CONFIG reference

  **Acceptance Criteria**:
  - [ ] `migrateLegacyConfig()` function removed
  - [ ] Legacy fallback code removed from `load()`
  - [ ] `projectPath` vs `projectRoot` consistency check added (warning only)
  - [ ] `npm run test src/config/__tests__/ConfigLoader.test.ts` → PASS (GREEN phase)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: ConfigLoader tests pass after implementation
    Tool: Bash (bun)
    Steps:
      1. Run: npx vitest run src/config/__tests__/ConfigLoader.test.ts
      2. Assert: All tests PASS
    Expected Result: Green - all ConfigLoader tests pass
    Evidence: .sisyphus/evidence/task-6-loader-green.txt

  Scenario: Old config triggers warning fallback
    Tool: Bash (bun)
    Steps:
      1. Mock fs-extra to return old-format JSON with codeSource, modulesPath, workspace
      2. Call ConfigLoader.load()
      3. Assert: Returns DEFAULT_WORKSPACE_CONFIG (not parsed old config)
      4. Assert: Logger.warn was called with message containing "Using defaults"
    Expected Result: Graceful fallback with warning, no migration attempt
    Evidence: .sisyphus/evidence/task-6-old-warning.txt
  ```

  **Commit**: YES (groups with Tasks 4-6)
  - Message: `feat(config): replace modulesPath/workspace/codeSource with projectPath`
  - Files: `src/config/ConfigLoader.ts`

- [x] 7. Update Electron main/index.ts (project:scan + config IPC)

  **What to do**:
  - Edit `src/main/index.ts`
  - **`project:scan` handler** (around lines 111-172):
    - Remove `currentCodeSource` variable (was `config.codeSource`)
    - Remove `modulesPath`/`codeSource.path` fallback chain for `moduleScanPath`
    - New logic: compute `moduleScanPath` as `path.join(config.projectPath, '.module-agent', 'module')`
    - Auto-create the directory: `fs.ensureDirSync(moduleScanPath)` before scanning
    - Scan `projectRoot` (primary) + `moduleScanPath` (additional) with dedup
    - Pass `config.projectPath` as `projectRoot`/`workspaceRoot` to orchestrator (replace `currentCodeSource`)
    - Remove `currentCodeSource` references (lines 139, 147-161)
  - **`config:save` handler** (around lines 456-472):
    - Remove `codeSource` and `modulesPath` handling
    - Accept only `command`, `args`, `projectPath` in updates
    - Apply updates: `if (updates.projectPath !== undefined) config.projectPath = updates.projectPath`
  - **`config:get` handler** (around lines 474-482):
    - Remove `codeSource` and `modulesPath` from return
    - Return only `command`, `args`, `projectPath`
  - **AgentOrchestrator construction** (line 160):
    - Replace `codeSource: config.codeSource` with new approach
    - Pass `projectPath: config.projectPath` directly

  **Must NOT do**:
  - Do NOT change `ModuleScanner.scan()` parameters or behavior
  - Do NOT remove the dedup logic for module scans

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex file with multiple IPC handlers, orchestrator construction, and module scanning integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 8-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 11 (WorkspaceIsolator needs projectPath from here)
  - **Blocked By**: Tasks 4-6 (schema, defaults, loader)

  **References**:
  - `src/main/index.ts:111-172` - `project:scan` handler to modify
  - `src/main/index.ts:456-482` - `config:save` and `config:get` handlers to modify
  - `src/main/index.ts:139-161` - orchestrator construction code
  - `src/config/defaults.ts` - DEFAULT_CONFIG_ENTRY for config:get fallback
  - `src/core/PathUtils.ts` - `normalizeCodeSourcePath()` usage (may simplify/remove)

  **Acceptance Criteria**:
  - [ ] `project:scan` uses `config.projectPath` for module scan path
  - [ ] `.module-agent/module/` auto-created before scan
  - [ ] `currentCodeSource` variable and all references removed
  - [ ] `config:save` IPC only handles `command`, `args`, `projectPath`
  - [ ] `config:get` IPC only returns `command`, `args`, `projectPath`
  - [ ] `npm run typecheck` — electron main compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: project:scan works with projectPath
    Tool: Bash (curl/Electron IPC)
    Preconditions: Valid .module-agent.json with projectPath set
    Steps:
      1. Verify .module-agent/module/ directory was created
      2. Verify orchestrator receives projectPath (check logs)
    Expected Result: Scan completes, modules found, no codeSource references in logs
    Evidence: .sisyphus/evidence/task-7-scan-works.txt

  Scenario: config:save with projectPath
    Tool: Bash (curl to Electron IPC)
    Steps:
      1. Invoke config:save with { command: "test", args: [], projectPath: "/tmp/proj" }
      2. Invoke config:get and verify projectPath is "/tmp/proj"
      3. Verify no codeSource or modulesPath in response
    Expected Result: Round-trip preserves projectPath, old fields absent
    Evidence: .sisyphus/evidence/task-7-config-roundtrip.txt
  ```

  **Commit**: YES (groups with Tasks 8-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/main/index.ts`

- [x] 8. Update CLI setup.ts

  **What to do**:
  - Edit `src/cli/commands/setup.ts`
  - Remove workspace path prompt (lines 131-135) — merge into projectPath prompt
  - Remove modulesPath prompt (lines 149-150, 194) — no longer needed
  - Remove codeSource prompts (type, git URL/branch, local path)
  - New flow: Prompt for `projectPath` once, explain that `.module-agent/module/` and `.module-agent/workspace/` will be auto-created
  - Remove `isConfigComplete()` checks for old fields
  - Update config writing to use only `projectPath`
  - Update summary display to show `projectPath` and derived paths

  **Must NOT do**:
  - Do NOT remove `module.md` auto-generation logic (generate.ts)
  - Do NOT change agent command/args prompts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: CLI file simplification, removing code paths
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7, 9-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6

  **References**:
  - `src/cli/commands/setup.ts` - Full file to modify
  - `src/cli/commands/setup.ts:52` - `isConfigComplete()` function
  - `src/cli/commands/setup.ts:120` - `ModuleGenerator.generate()` call (keep)
  - `src/config/defaults.ts` - New default values

  **Acceptance Criteria**:
  - [ ] CLI setup no longer prompts for workspace.path, modulesPath, codeSource
  - [ ] CLI setup prompts for projectPath (single prompt)
  - [ ] Generated `.module-agent.json` has only `projectPath` (no old fields)
  - [ ] `npm run build:cli` succeeds

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: CLI setup writes correct config
    Tool: interactive_bash (tmux)
    Preconditions: Clean temp directory
    Steps:
      1. Run: node dist/cli.cjs setup
      2. Send keys: "test-agent" Enter  (agent command)
      3. Send keys: Enter  (no extra args)
      4. Send keys: "/tmp/test-proj" Enter  (projectPath)
      5. Verify generated .module-agent.json has only projectPath field
      6. Verify no codeSource, modulesPath, or workspace.path in file
    Expected Result: Clean .module-agent.json with projectPath only
    Evidence: .sisyphus/evidence/task-8-cli-setup.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/cli/commands/setup.ts`

- [x] 9. Update TUI AgentService + config + renderer

  **What to do**:
  - Edit THREE files in a coordinated way:
  - **`src/tui/services/AgentService.ts`** (lines 69-96):
    - Remove `modulesPath`/`codeSource.path` fallback chain for `moduleScanPath`
    - New logic: `const moduleScanPath = path.join(this.config.projectPath, '.module-agent', 'module')`
    - Auto-create: `fs.ensureDirSync(moduleScanPath)` before scanning
    - Keep the dedup logic (Set-based) unchanged
    - Remove `codeSource` from config passed to `AgentManager`
  - **`src/tui/config.ts`** (line 52-54):
    - Update `writeModuleAgentJson()` to write `projectPath` instead of `workspace`, `modulesPath`, `codeSource`
    - Update merged config: `projectPath: entryConfig.projectPath ?? defaultConfig.projectPath`
  - **`src/tui/renderer.tsx`** (line 165):
    - Replace `const hasModulesPath = config.modulesPath || ...` check
    - New check: `const hasProjectPath = !!config.projectPath`
    - Update any warnings/messages

  **Must NOT do**:
  - Do NOT change the module scanning dedup algorithm
  - Do NOT change AgentManager constructor (Task 12 handles that)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Three coordinated file edits across TUI services
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-8, 10-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 10 (SetupWizard uses these)
  - **Blocked By**: Tasks 4-6

  **References**:
  - `src/tui/services/AgentService.ts:69-96` - Module scanning logic
  - `src/tui/config.ts:52-54` - Config writing
  - `src/tui/renderer.tsx:165` - Warning check

  **Acceptance Criteria**:
  - [ ] `AgentService.scanModules()` uses `projectPath` for derived module scan dir
  - [ ] `writeModuleAgentJson()` writes `projectPath` only (no old fields)
  - [ ] `renderer.tsx` warning uses `projectPath` check
  - [ ] `npm run typecheck` — TUI compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: TUI module scanning uses projectPath
    Tool: Bash (bun)
    Preconditions: Config with projectPath set
    Steps:
      1. Import and call AgentService.init(projectRoot)
      2. Call scanModules()
      3. Assert: .module-agent/module/ directory was accessed
      4. Assert: No reference to config.codeSource or config.modulesPath in logs
    Expected Result: Scanning uses derived paths from projectPath
    Evidence: .sisyphus/evidence/task-9-tui-scan.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/tui/services/AgentService.ts`, `src/tui/config.ts`, `src/tui/renderer.tsx`

- [x] 10. Update TUI SetupWizard.tsx

  **What to do**:
  - Edit `src/tui/components/SetupWizard.tsx`
  - Reduce steps: remove the separate workspace step and modulesPath step
  - New flow:
    1. Agent command prompt (keep)
    2. Agent args prompt (keep)
    3. Project path prompt (NEW - replaces 3 separate prompts)
       - Explain: "Enter project directory. .module-agent/module/ and .module-agent/workspace/ will be auto-created."
    4. Summary step (simplified)
  - Remove state variables: `workspacePath`, `modulesPath`, `codeSourceType`, `codeSourcePath`, `codeSourceUrl`, `codeSourceBranch`
  - Remove related signal: `fallbackWorkspacePath`, `fallbackModulesPath`
  - Update step navigation (lines 40-60) for reduced step count
  - Update `writeModuleAgentJson()` call to only pass `projectPath`

  **Must NOT do**:
  - Do NOT change the Ink rendering patterns (Box, Text, useInput)
  - Do NOT change agent command/args steps

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: TUI component simplification, removing steps
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-9, 11-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6, Task 9 (TUI config for writeModuleAgentJson)

  **References**:
  - `src/tui/components/SetupWizard.tsx` - Full file to modify
  - `src/tui/components/SetupWizard.tsx:22-31` - State signals to modify
  - `src/tui/components/SetupWizard.tsx:40-60` - Step navigation
  - `src/tui/config.ts` - `writeModuleAgentJson()` signature reference

  **Acceptance Criteria**:
  - [ ] SetupWizard has reduced step count (5 → ~3 steps)
  - [ ] No codeSource, modulesPath, or workspace fields in state
  - [ ] Single projectPath input step replaces old path inputs
  - [ ] `npm run typecheck` — component compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: SetupWizard writes correct config after simplification
    Tool: interactive_bash (tmux)
    Preconditions: TUI running in tmux
    Steps:
      1. Navigate through SetupWizard steps
      2. Enter projectPath at the unified step
      3. Complete wizard
      4. Read generated .module-agent.json
      5. Assert: Only projectPath field present, no codeSource/modulesPath/workspace
    Expected Result: Clean config file from reduced wizard
    Evidence: .sisyphus/evidence/task-10-wizard.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/tui/components/SetupWizard.tsx`

- [x] 11. Simplify WorkspaceIsolator.ts - remove codeSource, remove git

  **What to do**:
  - Edit `src/agents/WorkspaceIsolator.ts`
  - **Remove `resolveGitCodeSource()` entirely** (lines 91-123) — git clone/pull logic deleted
  - **Simplify `codeSourcePathForModule()`**:
    - Old signature: `codeSourcePathForModule(node: ModuleNode, codeSource: CodeSourceConfig): string`
    - New signature: `codeSourcePathForModule(node: ModuleNode, projectPath: string): string`
    - New logic: return `path.join(projectPath, node.relativePath)` directly
    - Remove `codeSource.type` switch (no git vs local distinction)
  - **Simplify `prepareModuleWorkspace()`**:
    - Old options: `{ workspaceRoot, codeSource, tempDir?, logger? }`
    - New options: `{ workspaceRoot, projectPath, tempDir?, logger? }`
    - Compute `srcDir` using new `codeSourcePathForModule()` with `projectPath`
    - Compute `destDir`: `path.join(workspaceRoot, node.relativePath || node.name)`
    - Compute `workspaceRoot` from projectPath: `path.join(projectPath, '.module-agent', 'workspace')`
    - **PRESERVE all 5 fallback paths** (lines 162, 183-186, 188-192, 195, 225-227)
    - **PRESERVE sub-module exclusion logic** (lines 197-206)
  - **Update `WorkspaceIsolator` interface** (lines 26-30):
    - Remove `codeSourcePathForModule` with old signature
    - Add `codeSourcePathForModule(node: ModuleNode, projectPath: string): string`
  - Remove any unused imports (`simple-git` if no other consumers)

  **Must NOT do**:
  - Do NOT change the file copy logic (`fse.copy` with filter)
  - Do NOT change sub-module exclusion behavior
  - Do NOT remove `simple-git` from package.json (may have other consumers)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex 130-line function with 5 fallback paths that must be preserved; git code removal requires careful understanding of the full function flow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-10, 12-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 12 (orchestrator passes to WorkspaceIsolator)
  - **Blocked By**: Tasks 4-6, Task 7 (projectPath propagation)

  **References**:
  - `src/agents/WorkspaceIsolator.ts:26-30` - WorkspaceIsolator interface
  - `src/agents/WorkspaceIsolator.ts:46-89` - `codeSourcePathForModule()` to simplify
  - `src/agents/WorkspaceIsolator.ts:91-123` - `resolveGitCodeSource()` to DELETE
  - `src/agents/WorkspaceIsolator.ts:152-229` - `prepareModuleWorkspace()` to simplify
  - `src/agents/WorkspaceIsolator.ts:162` - Fallback 1: no workspaceRoot
  - `src/agents/WorkspaceIsolator.ts:183-186` - Fallback 2: no source dir
  - `src/agents/WorkspaceIsolator.ts:188-192` - Fallback 3: source doesn't exist
  - `src/agents/WorkspaceIsolator.ts:195` - Fallback 4: srcDir === destDir
  - `src/agents/WorkspaceIsolator.ts:225-227` - Fallback 5: copy error
  - `src/agents/WorkspaceIsolator.ts:197-206` - Sub-module exclusion logic (preserve)

  **Acceptance Criteria**:
  - [ ] `resolveGitCodeSource()` function removed entirely
  - [ ] `codeSourcePathForModule()` signature simplified (projectPath param, no codeSource)
  - [ ] `prepareModuleWorkspace()` uses `projectPath` for source resolution
  - [ ] All 5 fallback paths preserved and functional
  - [ ] Sub-module exclusion logic preserved
  - [ ] No `codeSource` references anywhere in the file
  - [ ] `npm run typecheck` — WorkspaceIsolator compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: prepareModuleWorkspace with projectPath copies correctly
    Tool: Bash (bun REPL)
    Preconditions: Temp directory with mock module structure
    Steps:
      1. Create temp project: /tmp/test-proj/subdir/module.md
      2. Call prepareModuleWorkspace(node, { projectPath: "/tmp/test-proj", workspaceRoot: "/tmp/test-proj/.module-agent/workspace" })
      3. Assert: /tmp/test-proj/.module-agent/workspace/subdir/ exists with copied files
      4. Assert: node_modules/ and .git/ are NOT in the copy
    Expected Result: Files copied to workspace dir, node_modules/.git filtered out
    Evidence: .sisyphus/evidence/task-11-workspace-copy.txt

  Scenario: Fallback when source dir doesn't exist
    Tool: Bash (bun REPL)
    Steps:
      1. Call prepareModuleWorkspace with non-existent source path
      2. Assert: Returns destDir with warning (not throwing)
    Expected Result: Graceful fallback, no crash
    Evidence: .sisyphus/evidence/task-11-fallback.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/agents/WorkspaceIsolator.ts`

- [x] 12. Update AgentOrchestrator.ts + AgentManager.ts

  **What to do**:
  - Edit TWO files:
  - **`src/agents/AgentOrchestrator.ts`**:
    - Remove `codeSource` from constructor options (line ~94)
    - Remove `this.codeSource` field
    - In `_resolveCwd()` (lines 319-326): compute workspaceRoot as `path.join(projectPath, '.module-agent', 'workspace')`
    - Pass `projectPath` to `codeSourcePathForModule()` and `prepareModuleWorkspace()`
    - In `_resolveConfig()`: remove `codeSource` from loaded config usage
    - All `this.config.codeSource` references → remove or replace with `this.config.projectPath`
  - **`src/agents/AgentManager.ts`**:
    - Remove `codeSource` field from class (line ~20)
    - Remove `codeSource` from constructor (line ~25)
    - Remove `codeSource` propagation to AgentLauncher or orchestrator
    - Update `resolveAgentConfig()` to not reference `codeSource`

  **Must NOT do**:
  - Do NOT change agent spawning logic (`AgentLauncher.launch()`)
  - Do NOT change `resolveAgentConfig()` module fallback logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Removing fields and updating method signatures in two files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-11, 13-14)
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6, Task 11 (WorkspaceIsolator interface changes)

  **References**:
  - `src/agents/AgentOrchestrator.ts:94` - codeSource in constructor
  - `src/agents/AgentOrchestrator.ts:319-326` - `_resolveCwd()` method
  - `src/agents/AgentManager.ts` - Full file for codeSource removal

  **Acceptance Criteria**:
  - [ ] Zero `codeSource` references in AgentOrchestrator.ts
  - [ ] Zero `codeSource` references in AgentManager.ts
  - [ ] `_resolveCwd()` uses derived workspace path from `projectPath`
  - [ ] `npm run typecheck` — both files compile

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Orchestrator resolves CWD from projectPath
    Tool: Bash (bun REPL)
    Steps:
      1. Create mock orchestrator with projectPath: "/tmp/proj"
      2. Call _resolveCwd for a module node
      3. Assert: CWD points to /tmp/proj/.module-agent/workspace/<relativePath>
    Expected Result: Workspace path derived from projectPath
    Evidence: .sisyphus/evidence/task-12-cwd-resolution.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/agents/AgentOrchestrator.ts`, `src/agents/AgentManager.ts`

- [x] 13. Update preload types + index

  **What to do**:
  - Edit TWO files:
  - **`src/types/preload.ts`**:
    - Update `ModuleAgentAPI` interface:
      - `scanProject(projectRoot: string, workspaceRoot: string)` → `scanProject(projectRoot: string)` (remove workspaceRoot param)
      - `saveAgentConfig(...)`: Remove `codeSource?` and `modulesPath?` params, add `projectPath?: string`
      - `getAgentConfig(...)`: Remove `codeSource?` and `modulesPath?` from return type, add `projectPath?: string`
      - Update `AgentConfig` type to remove `codeSource`, `modulesPath`, add `projectPath`
    - Update `CodeSource` type: either remove entirely or mark as deprecated
  - **`src/preload/index.ts`**:
    - Update `scanProject`: `ipcRenderer.invoke('project:scan', projectRoot)` (remove second arg)
    - Update `saveAgentConfig`: pass `projectPath` instead of `codeSource`, `modulesPath`
    - Update `getAgentConfig`: destructure `projectPath` instead of `codeSource`, `modulesPath`

  **Must NOT do**:
  - Do NOT change the `contextBridge.exposeInMainWorld` API name
  - Do NOT remove the `onAgentEvent` callback registration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type definition updates and IPC parameter adjustments
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-12, 14)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 15-19 (renderer changes depend on preload types)
  - **Blocked By**: Tasks 4-6

  **References**:
  - `src/types/preload.ts:72-115` - ModuleAgentAPI interface and types
  - `src/preload/index.ts:7-44` - Preload bridge implementations

  **Acceptance Criteria**:
  - [ ] `scanProject` signature simplified (single param)
  - [ ] `saveAgentConfig` signature has `projectPath` (no `codeSource`/`modulesPath`)
  - [ ] `getAgentConfig` return type has `projectPath` (no old fields)
  - [ ] `npm run typecheck` — preload compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Preload API signatures match new schema
    Tool: Bash (bun)
    Steps:
      1. Run: npx tsc --noEmit
      2. Assert: No type errors from preload or renderer referencing old fields
    Expected Result: TypeScript compiles cleanly
    Evidence: .sisyphus/evidence/task-13-preload-types.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/types/preload.ts`, `src/preload/index.ts`

- [x] 14. Update renderer mocks

  **What to do**:
  - Edit `src/renderer/src/__mocks__/moduleAgent.ts`
  - Update `saveAgentConfig` mock signature: replace `_codeSource?`, `_modulesPath?` with `_projectPath?: string`
  - Update `getAgentConfig` mock return: replace `codeSource?`, `modulesPath?` with `projectPath?: string`
  - Update mock default return value: `projectPath: '/mock/project'` (remove `modulesPath: '/mock/modules'`)
  - Update `scanProject` mock: accept single param `projectRoot` (remove `_workspaceRoot`)
  - Update any helper functions that construct mock configs

  **Must NOT do**:
  - Do NOT change the mock factory structure (createMockModuleAgentApi)
  - Do NOT change trigger helpers (triggerStream, triggerCrossContext, etc.)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple mock signature updates
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7-13)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 15 (config store tests use these mocks)
  - **Blocked By**: Task 13 (preload types define the contract)

  **References**:
  - `src/renderer/src/__mocks__/moduleAgent.ts:42` - scanProject mock
  - `src/renderer/src/__mocks__/moduleAgent.ts:115-136` - saveAgentConfig/getAgentConfig mocks

  **Acceptance Criteria**:
  - [ ] `saveAgentConfig` mock uses `_projectPath` (not `_codeSource`, `_modulesPath`)
  - [ ] `getAgentConfig` mock returns `projectPath` (not old fields)
  - [ ] `scanProject` mock accepts single param
  - [ ] `npm run test` — existing renderer tests pass with updated mocks

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Mocks compatible with updated preload types
    Tool: Bash (bun)
    Steps:
      1. Run: npx vitest run
      2. Assert: All existing tests pass (no type errors from mock mismatches)
    Expected Result: All tests green
    Evidence: .sisyphus/evidence/task-14-mocks-pass.txt
  ```

  **Commit**: YES (groups with Tasks 7-14)
  - Message: `feat: update backend consumers for projectPath config`
  - Files: `src/renderer/src/__mocks__/moduleAgent.ts`

- [x] 15. Unify configStore localStorage fields

  **What to do**:
  - Edit `src/renderer/src/stores/config.ts`
  - **Remove separate refs**: Delete `workspacePath` ref, keep `projectPath` ref
  - **Update LS_KEYS**: 
    - Remove `lastWorkspace` key
    - Keep `lastProject` key (rename conceptually to `projectPath`)
  - **Update `loadFromLocalStorage()`**:
    - Read only `projectPath` from localStorage
    - Migration: if old `lastWorkspace` key exists, read it once and write to `projectPath`, then remove old key
  - **Update `saveToLocalStorage()`**:
    - Save only `projectPath` (remove `workspacePath` save)
  - **Update `saveToProject()`**:
    - Send `projectPath` to `window.moduleAgent.saveAgentConfig()` (not `codeSource`)
    - Remove `buildCodeSource()` helper function (or simplify)
    - Signature: `saveToProject(projectPath: string)` - pass `projectPath` directly
  - **Update `loadFromProject()`**:
    - Read `projectPath` from response (not `codeSource`, `modulesPath`)
  - **Update return/export**:
    - Remove `workspacePath` from store return
    - Keep `projectPath` in store return

  **Must NOT do**:
  - Do NOT remove `agentCmd`, `agentArgs`, or their localStorage keys
  - Do NOT change the Pinia store pattern (defineStore)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Coordinated changes across localStorage migration, IPC calls, and store interface
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 16-19)
  - **Parallel Group**: Wave 4
  - **Blocks**: Tasks 16-19 (views/components read from configStore)
  - **Blocked By**: Tasks 13-14 (preload types and mocks)

  **References**:
  - `src/renderer/src/stores/config.ts` - Full file to modify
  - `src/renderer/src/stores/config.ts:21` - `workspacePath` ref to remove
  - `src/renderer/src/stores/config.ts:27-34` - LS_KEYS and loadFromLocalStorage
  - `src/renderer/src/stores/config.ts:60-67` - saveToProject
  - `src/renderer/src/stores/config.ts:70-82` - loadFromProject
  - `src/types/preload.ts` - Updated API types (Task 13)

  **Acceptance Criteria**:
  - [ ] `workspacePath` ref removed from store
  - [ ] Old `lastWorkspace` localStorage key migrated once
  - [ ] `saveToProject()` sends `projectPath` (no `codeSource`)
  - [ ] `loadFromProject()` reads `projectPath` (no old fields)
  - [ ] Store return object has single `projectPath`
  - [ ] `npm run test src/renderer/src/stores/__tests__/config.test.ts` → PASS (updated)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Old localStorage workspacePath migrates to projectPath
    Tool: Bash (bun)
    Preconditions: localStorage has old "lastWorkspace" key set
    Steps:
      1. Run configStore.loadFromLocalStorage()
      2. Assert: projectPath is set to old workspacePath value
      3. Assert: old "lastWorkspace" key is removed from localStorage
    Expected Result: One-time migration successful
    Evidence: .sisyphus/evidence/task-15-migration.txt

  Scenario: saveToProject sends projectPath
    Tool: Bash (bun)
    Steps:
      1. Set configStore.projectPath = "/test/proj"
      2. Call configStore.saveToProject("/test/proj")
      3. Assert: window.moduleAgent.saveAgentConfig called with projectPath: "/test/proj"
      4. Assert: No codeSource in the call
    Expected Result: IPC call contains only projectPath
    Evidence: .sisyphus/evidence/task-15-save.txt
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Message: `feat: unify renderer config UI for projectPath`
  - Files: `src/renderer/src/stores/config.ts`, `src/renderer/src/stores/__tests__/config.test.ts`

- [x] 16. Update SetupView.vue

  **What to do**:
  - Edit `src/renderer/src/views/SetupView.vue`
  - **Remove workspace path UI**: Delete the workspace path input + browse button section
  - **Remove codeSource UI**: Delete the codeSource type select + path/url/branch inputs
  - **Keep only**: projectPath input + browse button, agent command, agent args
  - Update `startDisabled` computed: only check `configStore.projectPath` (no `workspacePath`)
  - Update `selectWorkspace()` function: remove or repurpose as `selectProjectPath()`
  - Update `startScan()`:
    - Only call `projectStore.scanProject(projectPath)` (single param)
    - Remove `workspacePath` parameter
  - Update form labels and descriptions to explain auto-creation of `.module-agent/` subdirs
  - Remove unused imports (ElOption for codeSource type, etc.)

  **Must NOT do**:
  - Do NOT change the router navigation to `/main`
  - Do NOT change the agent command/args sections
  - Do NOT remove the "开始扫描" button behavior

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue component UI simplification, Element Plus form modifications
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 15, 17-19)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 15 (configStore interface changes)

  **References**:
  - `src/renderer/src/views/SetupView.vue` - Full file to modify
  - `src/renderer/src/views/SetupView.vue:17` - `startDisabled` computed
  - `src/renderer/src/views/SetupView.vue:21-25` - `selectWorkspace()` function
  - `src/renderer/src/views/SetupView.vue:44-53` - Workspace input template section
  - `src/renderer/src/stores/config.ts` - Updated store interface (Task 15)

  **Acceptance Criteria**:
  - [ ] Workspace path input removed from SetupView
  - [ ] CodeSource type/path inputs removed from SetupView
  - [ ] `startScan()` calls `scanProject(projectPath)` with single param
  - [ ] Form validates with only `projectPath` required
  - [ ] `npm run typecheck` — Vue component compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: SetupView renders simplified form
    Tool: Playwright
    Preconditions: App launched, navigate to /setup
    Steps:
      1. Navigate to http://localhost:5173/setup
      2. Assert: Workspace path input is NOT visible
      3. Assert: Code source type select is NOT visible
      4. Assert: Project path input IS visible
      5. Assert: "开始扫描" button enabled when projectPath is set
      6. Take screenshot
    Expected Result: Clean form with only projectPath, agentCmd, agentArgs
    Evidence: .sisyphus/evidence/task-16-setup-view.png

  Scenario: SetupView scan triggers single-param API
    Tool: Playwright
    Steps:
      1. Fill in projectPath: "/tmp/test-proj"
      2. Click "开始扫描"
      3. Check network/IPC: scanProject called with 1 argument (not 2)
    Expected Result: scanProject(".../tmp/test-proj") called
    Evidence: .sisyphus/evidence/task-16-scan-call.txt
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Message: `feat: unify renderer config UI for projectPath`
  - Files: `src/renderer/src/views/SetupView.vue`

- [x] 17. Update SettingsDialog.vue

  **What to do**:
  - Edit `src/renderer/src/components/SettingsDialog.vue`
  - Mirror the SetupView changes:
    - Remove workspace path input + browse button
    - Remove codeSource type/path inputs
    - Keep projectPath, agentCmd, agentArgs inputs
  - Update `selectWorkspace()`: remove or repurpose
  - Update save logic: `configStore.saveToProject(projectPath)` (simplified)
  - Update `rescanNeeded` logic: only check if `projectPath` changed
  - Remove unused Element Plus components for codeSource type select

  **Must NOT do**:
  - Do NOT change the dialog open/close behavior
  - Do NOT change the agent command/args sections
  - Do NOT remove the "保存" (save) button

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Vue component simplification, form modifications
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 15-16, 18-19)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 15 (configStore), Task 16 (SetupView pattern to follow)

  **References**:
  - `src/renderer/src/components/SettingsDialog.vue` - Full file
  - `src/renderer/src/components/SettingsDialog.vue:38-42` - `selectWorkspace()`
  - `src/renderer/src/views/SetupView.vue` - Pattern reference (Task 16 output)

  **Acceptance Criteria**:
  - [ ] Workspace path input removed from SettingsDialog
  - [ ] CodeSource inputs removed from SettingsDialog
  - [ ] Save sends only projectPath
  - [ ] `npm run typecheck` — compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: SettingsDialog saves with simplified fields
    Tool: Playwright
    Preconditions: App on /main view, settings dialog open
    Steps:
      1. Click settings button to open dialog
      2. Assert: No workspace path or codeSource inputs visible
      3. Change projectPath to "/tmp/new-proj"
      4. Click save
      5. Assert: configStore.saveToProject called with only projectPath
      6. Assert: rescanNeeded emitted
    Expected Result: Simplified settings save triggers rescan
    Evidence: .sisyphus/evidence/task-17-settings-save.png
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Message: `feat: unify renderer config UI for projectPath`
  - Files: `src/renderer/src/components/SettingsDialog.vue`

- [x] 18. Update MainView.vue

  **What to do**:
  - Edit `src/renderer/src/views/MainView.vue`
  - Update `rescan()` call: `projectStore.scanProject(configStore.projectPath)` (single param)
  - Update auto-scan on mount: same single-param call
  - Update `projectName` computed: use `configStore.projectPath` directly
  - Remove any `workspacePath` references from template or script
  - Update `onMounted` auto-scan: `scanProject(configStore.projectPath)`

  **Must NOT do**:
  - Do NOT change the template structure (sidebar, tree, chat area)
  - Do NOT change theme/event handling

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple parameter cleanup in one component
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 15-17, 19)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Tasks 13 (preload types), 15 (configStore)

  **References**:
  - `src/renderer/src/views/MainView.vue:44` - `rescan()` function
  - `src/renderer/src/views/MainView.vue:53` - auto-scan on mount
  - `src/renderer/src/views/MainView.vue:81-84` - scan calls

  **Acceptance Criteria**:
  - [ ] All `scanProject` calls use single `projectPath` parameter
  - [ ] Zero `workspacePath` references in MainView
  - [ ] `npm run typecheck` — compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: MainView scan uses single projectPath param
    Tool: Playwright
    Steps:
      1. Navigate to /main with projectPath set
      2. Trigger rescan
      3. Check: scanProject called with 1 argument
    Expected Result: Clean single-param API call
    Evidence: .sisyphus/evidence/task-18-mainview-scan.txt
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Message: `feat: unify renderer config UI for projectPath`
  - Files: `src/renderer/src/views/MainView.vue`

- [x] 19. Update DrawerPanel.vue

  **What to do**:
  - Edit `src/renderer/src/components/DrawerPanel.vue`
  - Update `agentCwd` computed: 
    - Old: `configStore.workspacePath || configStore.projectPath`
    - New: `configStore.projectPath` only (workspace path is now auto-derived under projectPath)
  - Remove any `workspacePath` references from template

  **Must NOT do**:
  - Do NOT change the drawer panel layout or module info display
  - Do NOT change workspace path resolution logic beyond the computed property

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single computed property change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 15-18)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: Task 15 (configStore)

  **References**:
  - `src/renderer/src/components/DrawerPanel.vue:30-35` - `agentCwd` computed
  - `src/renderer/src/stores/config.ts` - Updated store (Task 15)

  **Acceptance Criteria**:
  - [ ] `agentCwd` uses only `configStore.projectPath`
  - [ ] Zero `workspacePath` references
  - [ ] `npm run typecheck` — compiles

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: DrawerPanel shows CWD from projectPath
    Tool: Playwright
    Steps:
      1. Open drawer panel for a module
      2. Assert: Agent CWD shows path under projectPath (not old workspacePath)
    Expected Result: CWD derived from unified projectPath
    Evidence: .sisyphus/evidence/task-19-drawer-cwd.png
  ```

  **Commit**: YES (groups with Tasks 15-19)
  - Message: `feat: unify renderer config UI for projectPath`
  - Files: `src/renderer/src/components/DrawerPanel.vue`

- [x] 20. Update AGENTS.md + CLAUDE.md

  **What to do**:
  - Edit both `AGENTS.md` and `CLAUDE.md`
  - In the config fields table (around line 59-61):
    - Replace `workspace.path` row with `projectPath` row
    - Replace `modulesPath` row with explanation that it's now auto-derived
    - Replace `codeSource.*` rows with note that `codeSource` is removed
  - New table entries:
    ```
    | `projectPath` | Root project directory. `.module-agent/module/` and `.module-agent/workspace/` are auto-created here | 
    ```
  - Update "When changing the schema" section: remove reference to `codeSource` consumers
  - Update any other sections mentioning `codeSource`, `modulesPath`, or `workspace.path`

  **Must NOT do**:
  - Do NOT change project structure documentation unrelated to config
  - Do NOT change build/verify instructions

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Documentation updates in two files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 21-22)
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6 (schema settled)

  **References**:
  - `AGENTS.md:59-61` - Config fields table
  - `AGENTS.md:63-65` - Config consumers section
  - `CLAUDE.md:59-61` - Same config fields table

  **Acceptance Criteria**:
  - [ ] `projectPath` documented in config fields table
  - [ ] Old fields marked as removed (or removed from docs)
  - [ ] Config consumers section updated

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Documentation accurately reflects new config schema
    Tool: Bash (grep)
    Steps:
      1. grep for "modulesPath" in AGENTS.md → should NOT find it in active docs
      2. grep for "projectPath" in AGENTS.md → should find it in config table
      3. grep for "codeSource" in AGENTS.md → should NOT find it in active docs
    Expected Result: Docs match new schema
    Evidence: .sisyphus/evidence/task-20-docs.txt
  ```

  **Commit**: YES (groups with Tasks 20-22)
  - Message: `docs: update config documentation for projectPath`
  - Files: `AGENTS.md`, `CLAUDE.md`

- [x] 21. Update docs/DESIGN.md + docs/MODULE_FORMAT.md

  **What to do**:
  - Edit `docs/DESIGN.md`:
    - Update workspace path documentation (line ~179) to describe new `projectPath` field
    - Remove `codeSource` references
    - Update three-directory model to single-directory model
  - Edit `docs/MODULE_FORMAT.md`:
    - Update "three directories" explanation (lines 9-24) to new model
    - Explain: projectPath → `.module-agent/module/` for module.md files, `.module-agent/workspace/` for isolation
  - Remove any code examples showing old config format

  **Must NOT do**:
  - Do NOT delete the files entirely
  - Do NOT change module.md format documentation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Documentation updates
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 20, 22)
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6

  **References**:
  - `docs/DESIGN.md:179` - Workspace path documentation
  - `docs/MODULE_FORMAT.md:9-24` - Three-directory model

  **Acceptance Criteria**:
  - [ ] `docs/DESIGN.md` reflects `projectPath` config
  - [ ] `docs/MODULE_FORMAT.md` reflects new directory model
  - [ ] No old config format examples in docs

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Design docs match new architecture
    Tool: Bash (grep)
    Steps:
      1. grep for "codeSource" in docs/ → should NOT find (or marked deprecated)
      2. grep for "projectPath" in docs/ → should find in updated docs
    Expected Result: Docs consistent with new schema
    Evidence: .sisyphus/evidence/task-21-design-docs.txt
  ```

  **Commit**: YES (groups with Tasks 20-22)
  - Message: `docs: update config documentation for projectPath`
  - Files: `docs/DESIGN.md`, `docs/MODULE_FORMAT.md`

- [x] 22. Update .module-agent.json sample

  **What to do**:
  - Edit `.module-agent.json` (repo root sample config)
  - Replace old fields with new `projectPath` field
  - New format:
    ```json
    {
      "configs": [
        {
          "name": "default",
          "agents": {
            "default": {
              "command": "opencode",
              "args": ["acp"]
            }
          },
          "exclude": [],
          "projectPath": "."
        }
      ],
      "defaultConfig": "default"
    }
    ```
  - Remove `workspace`, `codeSource`, `modulesPath` fields
  - Use `"."` as sensible default since this is a self-hosting sample

  **Must NOT do**:
  - Do NOT change `agents.default` config
  - Do NOT change `defaultConfig` field

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single JSON file edit
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 20-21)
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: Tasks 4-6 (schema settled)

  **References**:
  - `.module-agent.json` - Current sample config
  - `src/config/defaults.ts` - DEFAULT_CONFIG_ENTRY for reference

  **Acceptance Criteria**:
  - [ ] `.module-agent.json` has `projectPath` field
  - [ ] `.module-agent.json` has NO `codeSource`, `workspace`, `modulesPath` fields
  - [ ] Config can be parsed by `WorkspaceConfigSchema` (Zod validation passes)

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Sample config validates with new schema
    Tool: Bash (bun)
    Steps:
      1. Run: node -e "const c=require('./.module-agent.json'); const z=require('./src/config/schema'); console.log(z.WorkspaceConfigSchema.safeParse(c))"
      2. Assert: result.success === true
    Expected Result: Sample config passes Zod validation
    Evidence: .sisyphus/evidence/task-22-sample-valid.txt
  ```

  **Commit**: YES (groups with Tasks 20-22)
  - Message: `docs: update config documentation for projectPath`
  - Files: `.module-agent.json`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, grep codebase). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Verify `codeSource` references are fully removed. Check evidence files exist in `.sisyphus/evidence/`.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run typecheck`. Run `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify all test files pass.
  Output: `Typecheck [PASS/FAIL] | Tests [N pass/N fail] | Lint [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (Electron scan + TUI scan consistency). Test edge cases: empty projectPath, missing `.module-agent/` subdirs, old config warning. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `test(config): add schema, defaults, and loader tests for projectPath` - 3 new test files
- **Wave 2**: `feat(config): replace modulesPath/workspace/codeSource with projectPath` - schema.ts, defaults.ts, ConfigLoader.ts
- **Wave 3**: `feat: update backend consumers for projectPath config` - main/index.ts, CLI, TUI services, WorkspaceIsolator, orchestrator, preload
- **Wave 4**: `feat: unify renderer config UI for projectPath` - stores, views, components, mocks
- **Wave 5**: `docs: update config documentation for projectPath` - AGENTS.md, CLAUDE.md, docs/, sample config

---

## Success Criteria

### Verification Commands

```bash
npm run typecheck        # Expected: zero errors
npm run test             # Expected: all tests pass (new + existing)
npm run test:e2e         # Expected: smoke test passes
npm run build:electron   # Expected: builds successfully
npm run build:cli        # Expected: builds successfully
```

### Final Checklist

- [x] All "Must Have" present and verified
- [x] All "Must NOT Have" absent (searched codebase)
- [x] Zero `codeSource` references remaining (except in `git log`)
- [x] Zero `modulesPath` references remaining (except in `git log`)
- [x] Zero `workspace.path` references remaining (except in `git log`)
- [x] All new tests pass
- [x] All existing tests still pass
- [x] TypeScript compiles with zero errors
- [x] Both Electron and CLI builds succeed
