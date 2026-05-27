import { test, expect } from '@playwright/test'

test('app loads and shows setup screen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('ModuleAgent')
  await expect(page.locator('#app')).toBeVisible()
  await page.screenshot({ path: '.sisyphus/evidence/task-38-e2e-smoke.png', fullPage: true })
})
