## SetupView.vue Wabi-sabi Style Rewrite

### Changes Applied
- **Card border-radius**: 10px (was default Element Plus)
- **Card box-shadow**: `var(--el-box-shadow-light)` (0 1px 3px) — minimal shadow
- **Input wrappers**: Added `box-shadow: none !important` via `:deep(.el-input__wrapper)` to remove Element Plus default focus glow
- **Input focus state**: `:deep(.el-input__wrapper.is-focus)` — border-color set to `var(--el-color-primary)`, box-shadow none
- **Select inputs**: `:deep(.el-select .el-input__wrapper)` — also box-shadow none
- **Form label spacing**: `margin-bottom: 8px` added to `:deep(.el-form-item__label)` for increased vertical rhythm

### Key Patterns
- All colors, shadows, radii reference `--el-*` CSS variables (overridden by wabi-sabi.css)
- Deep selectors (`:deep()`) required to penetrate Element Plus component shadow DOM
- `!important` needed to override Element Plus' own `box-shadow` defaults on input wrappers

### Pre-existing Issues (unrelated)
- `npm run typecheck` shows ~90+ errors in `src/tui/`, `src/agents/WorkspaceIsolator.ts`, TUI JSX types — none from SetupView.vue

## MessageModal.vue — Wabi-sabi style rewrite

**Date:** 2026-05-05

### Changes made
- Replaced entire `<style scoped>` block (was ~130 lines of CSS)
- **Dialog:** Added `:deep(.el-dialog)` with `border-radius: 10px`, `box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1)` (minimal, was no override — Element Plus heavy default), `animation: none !important` (kills default scale+translate pop)
- **Dialog header:** `padding: 16px 20px 12px`, `border-bottom: 1px solid var(--el-border-color)` (was `14px 20px` with `var(--border)`)
- **Dialog title:** `color: var(--el-color-primary)` (was `--accent2`)
- **7 status badges:** Replaced all hardcoded rgba/hex colors with `--el-color-*` variables matching ContextCards Task 7 spec:
  - `sent` → `--el-color-info-light-8` bg, `--el-color-info` text
  - `pending` → `--el-color-warning-light-7` bg, `--el-color-warning` text
  - `thinking` → `--el-color-primary-light-7` bg, `--el-color-primary` text
  - `executing` → `--el-color-success-light-7` bg, `--el-color-success` text
  - `completed` → `--el-color-success-light-8` bg, `--el-color-success` text
  - `error` → `--el-color-danger-light-7` bg, `--el-color-danger` text
  - `interrupted` → `--el-color-warning-light-8` bg, `--el-color-warning` text
- **Section dividers:** `.modal-section` now uses `padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter)` + `:last-child { border-bottom: none }` (was `margin-bottom: 12px` with independent card backgrounds)
- **Content text:** Removed `background: var(--bg)` — dividers carry visual weight instead of card blocks. Kept border with `var(--el-border-color)`.
- **Info grid:** Removed per-`.mg-item` borders, added single `border-bottom: 1px solid var(--el-border-color-lighter)` on `.modal-info-grid` + `padding-bottom: 12px` — treats grid as one unified section
- **Hardcoded colors migrated:**
  - `.thinking-text` border: `rgba(160, 160, 200, 0.15)` → `var(--el-border-color-lighter)`
  - `.tools-text` color: `#f0a000` → `var(--el-color-warning)`
  - `.tools-text` border: `rgba(240, 160, 0, 0.15)` → `var(--el-color-warning-light-8)`
- **Legacy var migration:** `--text`→`--el-text-color-primary`, `--text-dim`→`--el-text-color-secondary`, `--border`→`--el-border-color`/`--el-border-color-lighter`, `--bg`→removed, `--accent`/`--accent2`→`--el-color-primary`

### Key decisions
- Removed `background` from content areas entirely — wabi-sabi flat design uses divider lines not card blocks
- `.mg-item` individual row borders removed; single container border unifies the info grid
- Both `--accent` and `--accent2` collapse into `--el-color-primary` (single accent in wabi-sabi palette)
- Template and script sections untouched

### Verification
- `npm run typecheck` — zero new errors from MessageModal.vue or any renderer file. All errors pre-existing in `src/tui/` (React JSX) and `src/agents/` (TS6305)
