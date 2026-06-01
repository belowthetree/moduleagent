// ---------------------------------------------------------------------------\n// e2e/smoke.spec.ts — Playwright E2E 冒烟测试\n// 验证应用加载、显示设置界面等基本路径\n// ---------------------------------------------------------------------------\n\nimport { test, expect } from '@playwright/test'

test('app loads and shows setup screen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('ModuleAgent')
  await expect(page.locator('#app')).toBeVisible()
  await page.screenshot({ path: '.sisyphus/evidence/task-38-e2e-smoke.png', fullPage: true })
})
