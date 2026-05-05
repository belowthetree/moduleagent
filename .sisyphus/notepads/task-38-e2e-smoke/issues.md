# Issues — Task 38: Playwright E2E Smoke Test

## Browser Installation Failure
- **Problem**: `npx playwright install chromium` fails — download of 170MB Chrome for Testing from `storage.googleapis.com` times out (30s request timeout)
- **Root cause**: Network environment cannot reach Google Cloud Storage (redirect from cdn.playwright.dev → storage.googleapis.com)
- **Impact**: Playwright test runs but fails at browser launch: "Executable doesn't exist"
- **Workaround for CI**: CI environment should have network access to GCS; this is a local env limitation only
- **Alternative not tried**: System chromium via apt (chromium-browser is a transitional snap package on this distro)

## LSP Not Installed
- `typescript-language-server` not available in this environment
- Pre-existing TS errors in `src/tui/` (React JSX types missing in main tsconfig) are unrelated to this task
- My new files (`playwright.config.ts`, `e2e/smoke.spec.ts`) are outside tsconfig scope and handled by Playwright's own TS support

## Test Execution Result
- Test is correctly discovered and runs
- Fails only due to missing browser binary (not infrastructure/config issue)
- Dev server (electron-vite) starts successfully on port 5173
