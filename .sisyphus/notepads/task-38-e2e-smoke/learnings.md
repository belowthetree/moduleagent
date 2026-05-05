# Learnings — Task 38: Playwright E2E Smoke Test

## Project Structure for E2E
- `@playwright/test` v1.59.1 already in devDependencies
- `test:e2e` script already `playwright test` in package.json
- No existing `playwright.config.ts` or `e2e/` directory before this task
- Renderer dev server: `electron-vite dev` starts Vite on port 5173
- CSP managed in main process (not in HTML), so Vite dev works without CSP issues

## File Locations
- `playwright.config.ts` → project root (Playwright convention)
- `e2e/smoke.spec.ts` → test files in `e2e/` directory

## Dev Server
- `npx electron-vite dev` successfully builds main, preload, and starts renderer dev server on :5173
- Renderer is a Vue 3 app with Vue Router + Element Plus + Pinia
- Title is "ModuleAgent" (in both `electron/renderer/index.html` and `src/renderer/index.html`)

## Test Configuration
- `webServer` config in playwright.config.ts auto-starts/stops dev server
- `reuseExistingServer: !process.env.CI` avoids restarting in local dev
- `baseURL: 'http://localhost:5173'` so tests use relative paths
