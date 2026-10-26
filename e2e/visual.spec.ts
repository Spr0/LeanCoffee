import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Screenshots of every session screen for review against the mockups, plus the Stage view at
// Teams screen-share sizes. Saved under test-results/screens.
const SIZES = [
  [1440, 900],
  [1920, 1080],
  [1280, 720],
  [960, 900],
] as const

/**
 * Screenshots the screen at each size, then runs axe in light and dark (prompt 7.4). Dark mode is
 * toggled with the header button, which stays reachable unless a modal dialog is open.
 */
async function shoot(
  page: Page,
  name: string,
  sizes: readonly (readonly [number, number])[] = [SIZES[0]],
  themes = true,
) {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    await page.screenshot({ path: `test-results/screens/${name}-${w}x${h}.png` })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const violations = async (theme: string) => {
    const r = await new AxeBuilder({ page }).analyze()
    return r.violations.map(
      (v) => `${name} (${theme}): ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    )
  }
  const found = await violations('current theme')
  if (themes) {
    const before = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
    found.push(...(await violations(before === 'dark' ? 'light' : 'dark')))
    await page.screenshot({ path: `test-results/screens/${name}-alt-theme-1440x900.png` })
    await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
  }
  expect(found).toEqual([])
}

test('capture every session screen', async ({ browser }) => {
  test.setTimeout(180_000)
  const fac = await (await browser.newContext()).newPage()
  const pat = await (await browser.newContext()).newPage()
  await fac.goto('/')
  await shoot(fac, 'home')
  await fac.getByLabel('Name', { exact: true }).fill('Priya')
  await fac.getByLabel('Name this session').fill('E2E Product team sync')
  await fac.getByRole('button', { name: 'Create board' }).click()
  await expect(fac.getByTestId('room-code')).toBeVisible()
  await pat.goto(fac.url())
  await pat.setViewportSize({ width: 390, height: 844 })
  await pat.screenshot({ path: 'test-results/screens/join-390x844.png' })
  await pat.getByLabel('Name', { exact: true }).fill('Maya')
  await pat.getByRole('button', { name: 'Join session' }).click()
  await pat.setViewportSize({ width: 1440, height: 900 })
  await expect(fac.getByRole('list', { name: 'People here now' })).toContainText('Maya')
  await shoot(fac, 'lobby')
  await fac.getByRole('button', { name: /Start brainstorm/ }).click()
  for (const [page, text] of [
    [fac, 'Making async updates actually get read'],
    [pat, 'How do we onboard remote hires in their first two weeks?'],
    [pat, 'AI tools: what is actually saving us time?'],
  ] as const) {
    await page.getByLabel('New topic').fill(text)
    await page.getByLabel('New topic').press('Enter')
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  await shoot(fac, 'brainstorm')
  await fac.getByRole('button', { name: 'End brainstorm now' }).click()
  await fac.getByRole('button', { name: 'Start pitches' }).click()
  await expect(fac.getByText('PITCHING NOW')).toBeVisible()
  await shoot(fac, 'clarify')
  await fac.getByRole('button', { name: 'Continue to voting' }).click()
  await pat
    .getByRole('button', { name: 'Add a dot to "Making async updates actually get read"' })
    .click()
  await shoot(pat, 'vote')
  await fac.getByRole('button', { name: 'Reveal results now' }).click()
  await expect(fac.getByRole('region', { name: 'Results' })).toBeVisible()
  await shoot(fac, 'vote-results')
  await fac.getByRole('button', { name: 'Start discussing' }).click()
  await fac.getByRole('button', { name: /Start the .* clock/ }).click()
  await expect(fac.getByText('DISCUSSING NOW')).toBeVisible()
  await shoot(fac, 'stage', SIZES)
  await fac.getByRole('button', { name: 'Switch to dark mode' }).click()
  await fac.getByRole('button', { name: 'Call vote now' }).click()
  await expect(fac.getByRole('region', { name: 'Extend vote' })).toBeVisible()
  await shoot(fac, 'stage-dark-extend', SIZES)
  await fac.getByRole('button', { name: 'Switch to light mode' }).click()
  await fac.getByRole('button', { name: '2 people' }).click()
  await shoot(fac, 'people', undefined, false)
  await fac.getByRole('button', { name: 'Pass facilitator role' }).click()
  await fac.getByRole('radio', { name: 'Maya' }).check()
  await shoot(fac, 'handover', undefined, false)
  await fac.getByRole('button', { name: 'Cancel' }).click()
  await fac.getByRole('button', { name: 'Done' }).click()
  await fac.getByRole('button', { name: 'Downloads' }).click()
  await shoot(fac, 'downloads', undefined, false)
  await fac.getByRole('button', { name: 'Done' }).click()
  const onStage = (await fac.getByRole('heading', { level: 1 }).textContent()) ?? ''
  await fac.getByRole('button', { name: 'Next topic', exact: true }).click()
  await expect(fac.getByRole('region', { name: 'Discussed' })).toContainText(onStage)
  await shoot(fac, 'between-topics', SIZES)
  await fac.getByRole('button', { name: 'Start wrap-up' }).first().click()
  await pat.getByLabel('Your take-away').fill('Buddy system first, docs second.')
  await pat.getByRole('button', { name: 'Share' }).click()
  await expect(fac.getByText('Buddy system first, docs second.')).toBeVisible()
  await shoot(fac, 'wrapup')
})
