# Decisions — Task 38: Playwright E2E Smoke Test

## Config choices
- **testDir: './e2e'** — separate directory for E2E tests, convention overloading `tests/`
- **browserName: 'chromium'** — single browser for smoke test; could add firefox/webkit later
- **webServer: electron-vite dev** — uses the existing dev server setup; no separate Vite config needed
- **baseURL in use config** — allows relative paths in tests (just `page.goto('/')`)

## Test scope
- Minimal smoke test: title assertion + #app visibility + screenshot
- No Electron-specific APIs tested (those require real Electron process)
- Full 12-scenario E2E will be added in Final Verification Wave (F3)

## Screenshot path
- Saved to `.sisyphus/evidence/task-38-e2e-smoke.png` per task spec
- Uses `fullPage: true` to capture entire page content
