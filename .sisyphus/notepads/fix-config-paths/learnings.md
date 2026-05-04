# Learnings: Fix Config Paths

## What was wrong
- `resolveConfigDir()` used hardcoded `..` path segments that assumed a fixed directory depth from the source file to the repo root
- CJS branch: `path.resolve(__dirname, '..', 'config')` — correct when `__dirname` = `dist/` but wrong from `src/agents/`
- ESM branch: `path.resolve(moduleDir, '..', '..', 'config')` — correct from `src/agents/` but fragile

## Fix approach
- Walk up the directory tree from the current module's location until `package.json` is found
- Use that as the repo root, then `path.join(root, 'config')`
- Works regardless of source location depth (1 level in bundled CJS, 2 levels in source ESM, or any nesting)

## Where AgentRouter is actually used
- Only `src/tui/services/AgentService.ts` imports it
- NOT in CLI bundle (`dist/cli.cjs`)
- NOT in Electron main bundle (`electron/main.cjs`)
- NOT in MCP server bundle (`dist/mcp-server.cjs`)
- TUI runs via Bun/tsx in ESM mode, so `import.meta.url` path works

## Verified
- ESM path: walks from `src/agents/` → finds `package.json` at repo root → returns `<repo>/config/`
- CJS path (simulated): walks from `dist/` → finds `package.json` at repo root → returns `<repo>/config/`
- Both `config/mainagentprompt.md` and `config/subagentprompt.md` exist at resolved path
- Build (`npm run build:cli`) passes with expected `import.meta` warnings (safe, guarded by `typeof`)
