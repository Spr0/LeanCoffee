import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('home page renders and has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Run a Lean Coffee session' }),
  ).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('dark theme is remembered across reloads', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('an unknown board code shows a not-found page', async ({ page }) => {
  await page.goto('/b/ZZZZ-ZZZZ')
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible()
})
