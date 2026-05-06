# Decisions

- Field name: `projectPath` (matches `workspace.path` naming convention)
- Merge scope: `modulesPath` + `workspace.path` + `codeSource.path` + entire `codeSource` object
- Auto-derived dirs: `.module-agent/module/` and `.module-agent/workspace/`
- No backward compatibility - old configs silently fall back to defaults
- Default value: `projectPath: '.'`
- TDD: tests written first (RED → GREEN → REFACTOR)

