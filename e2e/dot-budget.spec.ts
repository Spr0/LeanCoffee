import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// The dot budget as people really vote (decision D89): one click per dot, each click sending the
// topic's new total. Needs the 20261026100000 migration: before it, the third dot stacked on one
// topic, or a second on a topic after a dot elsewhere, was refused as over budget.
test('dots stack on one topic one click at a time, and move between topics', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const fran = await (await browser.newContext()).newPage()
  const pat = await (await browser.newContext()).newPage()
  const guards = [guard(fran), guard(pat)]
  const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
  const card = (text: string) =>
    fran.getByRole('region', { name: 'To discuss' }).getByRole('listitem').filter({ hasText: text })

  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E dot budget ${Date.now()}`)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  const start = btn(fran, 'Start brainstorm for 2 people')
  // A freshly started local Realtime can take a while to stream changes; see full-session.
  await expect(start).toBeVisible({ timeout: 45_000 })
  await start.click()

  // Pat writes both topics, so Fran can vote on each.
  const [stacked, spread] = ['Stacked topic', 'Spread topic']
  for (const text of [stacked, spread]) {
    await pat.getByLabel('New topic').fill(text)
    await pat.getByLabel('New topic').press('Enter')
    await expect(pat.getByText(text, { exact: true })).toBeVisible()
  }
  await btn(fran, 'End brainstorm now').click()
  await btn(fran, 'Skip pitches').click()

  // Each dot is saved before the next click, as a slow voter's would be.
  const saved: boolean[] = []
  const click = async (name: string) => {
    const [response] = await Promise.all([
      fran.waitForResponse((r) => r.url().includes('/rpc/cast_dots')),
      btn(fran, name).click(),
    ])
    saved.push(response.ok())
  }
  for (let i = 0; i < 3; i++) await click(`Add a dot to "${stacked}"`)
  await expect(fran.getByText('0 left', { exact: true })).toBeVisible()
  // Two come off, one goes on the other topic, and one goes back on the first.
  await click(`Remove a dot from "${stacked}"`)
  await click(`Remove a dot from "${stacked}"`)
  await click(`Add a dot to "${spread}"`)
  await click(`Add a dot to "${stacked}"`)
  expect(saved).toEqual(Array(7).fill(true))
  await expect(fran.getByRole('alert')).toHaveCount(0)
  await expect(fran.getByText('0 left', { exact: true })).toBeVisible()

  await btn(fran, 'Reveal results now').click()
  await expect(fran.getByRole('region', { name: 'Results' })).toBeVisible()
  await expect(card(stacked)).toContainText('2 votes')
  await expect(card(spread)).toContainText('1 vote')
  for (const g of guards) g.check()
})
