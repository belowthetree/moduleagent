# F3: Real Manual QA — Learnings

## Findings

### Build
- Full build (`npm run build:electron`) passes in ~32s — electron-vite handles all 3 phases, then esbuild for MCP/CLI
- CLI build warns about `import.meta` in CJS — pre-existing, non-fatal
- Output files all correct sizes and locations

### Tests
- Core store tests (config, agent, stream): all 25 pass cleanly
- SVGTree component tests: 5 failures all from `SupportedEventInterface is not a constructor`
  - Root cause: `@vue/test-utils` v2.4.10 + jsdom v29.1.1 incompatibility on Linux
  - The `SupportedEventInterface` check in vue-test-utils doesn't recognize jsdom's event interfaces
  - Workaround: either upgrade jsdom, downgrade vue-test-utils, or use happy-dom
  - This is an **environment issue**, not a code defect
- One dot-streaming assertion mismatch: test expects streaming agent on node 0, but Map iteration order differs

### Type Check
- After `tsc -b` to generate project reference declarations, `tsc --noEmit` shows:
  - TS6307: files not in tsconfig.node.json include — pre-existing scaffold issue (tsconfig uses `include: ["src/main/**/*"]` but main imports files from `src/core/`, `src/agents/`, etc.)
  - These are NOT new — they were present before the migration
  - TUI JSX errors (~90) are pre-existing and unrelated
- Filtered for new errors only: **zero** new type errors introduced

### IPC Contract
- All 13 IPC channel names identical between `electron/preload.ts` and `src/preload/index.ts`
- Only differences: TypeScript type annotations (inline types → shared `ScanResult`/`AgentStatus`)
- Zero runtime behavioral changes

### localStorage Compatibility
- All 11 legacy keys preserved with identical names and semantics
- 2 new keys (`splitRatio`, `theme`) are additive — no data migration conflict
- Legacy data survives the migration path

### File Structure
- Standard electron-vite layout fully realized: `src/main/`, `src/preload/`, `src/renderer/`
- All 15 planned components present
- All 3 stores + tests present
- Legacy `electron/` directory preserved with `// @legacy` markers
