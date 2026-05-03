# Scope Fidelity Check Results

**Date**: 2026-05-03
**Verdict**: **REJECT** — 8 files modified outside approved scope, including 2 explicit guardrail violations.

---

## Check 1: Expected Files — PASS ✓

All 19 expected deliverables exist:
- `src/tui/types.ts` ✓
- `src/tui/state.ts` ✓
- `src/tui/config.ts` ✓
- `src/tui/App.tsx` ✓
- `src/tui/renderer.tsx` ✓ (plan says `.ts` but `.tsx` is correct for JSX)
- `src/tui/commands.ts` ✓
- `src/tui/tsconfig.json` ✓
- `src/tui/bunfig.toml` ✓
- `src/tui/components/StatusBar.tsx` ✓
- `src/tui/components/InputBox.tsx` ✓
- `src/tui/components/ContextArea.tsx` ✓
- `src/tui/components/CommandPalette.tsx` ✓
- `src/tui/components/SetupWizard.tsx` ✓
- `src/tui/components/index.ts` ✓
- `src/tui/services/AgentService.ts` ✓
- `src/tui/services/StreamHandler.ts` ✓
- `src/tui/services/index.ts` ✓
- `src/cli/tui-entry.ts` ✓ (new)
- `src/cli/index.ts` ✓ (updated tui case)

No unexpected files in `src/tui/`.

---

## Check 2: Scope Creep — FAIL ⛔

### Explicit Guardrail Violations (from plan "Must NOT Have")

| File | Plan Rule | Violation |
|------|-----------|-----------|
| **`src/agents/AgentManager.ts`** | "Do NOT modify AgentManager/AgentLauncher/AgentRouter 接口" | Added `setMode()`, `setAllModes()`, `getAvailableModes()` methods; added `modeState` field to `AgentEntry`; imported `SessionModeState` and `SessionMode` types |
| **`electron/main.ts`** | "Do NOT modify Electron path or esbuild build pipeline" | Added `mcpDataDir()`; changed MCP graph file and git cache from `os.tmpdir()` to `.module-agent/`; removed `os` import |

### Other Files Modified Outside Scope

| File | Type | Description |
|------|------|-------------|
| `src/config/defaults.ts` | MODIFIED | Changed workspace default from `~/.module-agent/workspaces` to `.module-agent/workspaces` |
| `src/context/FileStore.ts` | MODIFIED | Changed context storage from `os.homedir()` based to project-relative paths; removed `os` and `crypto` imports |
| `src/cli/commands/setup.ts` | MODIFIED | Major rewrite: added `isConfigComplete()`, restructured flow, added workspace/codeSource fields, auto-generates module.md |
| `src/cli/utils/project-root.ts` | MODIFIED | Changed from global `~/.module-agent/state.json` to per-project `.module-agent/state.json`; added `findSavedProject()` |
| `src/cli/commands/tui.ts` | DELETED | Old tui command stub removed |
| `src/cli/commands/input.ts` | DELETED | Unrelated file removed |
| `module-agent.bat` | MODIFIED | Changed from `node`+`npm run build:cli` to `bun run`; added Bun requirement check |
| `module-agent.sh` | MODIFIED | Changed from `node`+`npm run build:cli` to `bun run`; added Bun requirement check |
| `.gitignore` | MODIFIED | Added `.module-agent/` to ignore list |
| `.module-agent.json` | MODIFIED | Agent command changed from `claude` to `opencode`; args changed |
| `.claude/settings.local.json` | MODIFIED | Added Bun-related permission entries |

**Total: 8 functionally modified files + 3 config/ignored files + 2 deletions outside approved scope**

---

## Check 3: Package Scope — PASS ✓

Exactly 3 new deps added to `package.json`:
- `@opentui/core` ^0.2.2
- `@opentui/solid` ^0.2.2
- `@opentui/keymap` ^0.2.2

`bun.lock` created (expected from `bun add`).
`package-lock.json` modified (npm auto-update, minor).

---

## Check 4: Spider File Deleted — PASS ✓

`src/tui/__spike__/` does not exist — correctly cleaned up.

---

## Check 5: Plan Fidelity — PASS ✓

Checkbox count: 15 `[x]` (Tasks 1-15), 4 `[ ]` (F1-F4) — matches expected.

---

## Root Cause Analysis

The modifications to `AgentManager.ts` are the most critical violation. The plan's `/mode` command (Task 14) requires `setMode()` / `setAllModes()` / `getAvailableModes()` methods that did not exist on `AgentManager`. Rather than implementing mode switching entirely within the TUI service layer (e.g., via direct connection calls wrapped in `AgentService`), the implementation modified the shared `AgentManager` class.

The other changes (`FileStore`, `project-root.ts`, `defaults.ts`, `electron/main.ts`) appear to be a tangential refactoring: moving state from `os.homedir()` to project-relative `.module-agent/` directories. This is a legitimate improvement but NOT part of the TUI scope.

---

## VERDICT: REJECT

**Reasons:**
1. **2 explicit guardrail violations** (AgentManager.ts, electron/main.ts)
2. **6+ other files modified** outside `src/tui/` and `src/cli/index.ts`
3. **2 files deleted** outside scope
4. Plan commit strategy explicitly states: "Files: `src/tui/**`, `src/cli/index.ts`" — 15+ files violate this

**Recommended action**: Separate the tangential refactoring into its own plan/PR. Keep TUI implementation strictly within `src/tui/` + `src/cli/index.ts` + `src/cli/tui-entry.ts`. The `/mode` command should use the existing AgentManager API or wrap mode calls entirely within `AgentService` without modifying `AgentManager.ts`.
