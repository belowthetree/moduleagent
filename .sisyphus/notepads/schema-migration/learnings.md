
## F3: Schema Migration QA Learnings — Wed May 06 2026

### Passed Approaches
1. **Zod `.strip()` default behavior**: Old fields (codeSource, workspace, modulesPath) are silently stripped when a valid config also includes `projectPath`. This is acceptable — the old fields are effectively ignored.
2. **Old-format rejection**: Old configs without `projectPath` are rejected because the field is `z.string()` (required). ConfigLoader falls back to `DEFAULT_WORKSPACE_CONFIG` gracefully.
3. **Real-file testing pattern**: Writing tests that create temp dirs with real fs-extra (not mocked) caught edge cases that unit tests miss.

### Gotchas
1. **Empty string projectPath**: `z.string()` accepts `""`. If empty paths are invalid, add `.min(1)` to the schema.
2. **No cross-field validation**: WorkspaceConfigSchema doesn't check that `defaultConfig` references an existing config name. Handled by `ConfigLoader.getDefaultConfig()` at runtime — correct design.
3. **Pre-existing typecheck errors**: The project has many pre-existing TS6305 (declaration emit) and JSX-related errors unrelated to config changes.

### Test Architecture
- 5 test suites totaling 54 tests
- Mocked tests (ConfigLoader) + real-file tests (temp dirs) + pure Zod logic tests
- All tests are fast (<1s for all 54 tests)

### Verdict
**APPROVE** — Schema migration to `projectPath` is complete and correct. No regressions. 54/54 tests pass.
