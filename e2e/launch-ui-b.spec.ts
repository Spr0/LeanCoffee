import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// Launch fixes, client side: the Brainstorm clock waits for the facilitator (D64), -1 min, the
// pitch and wrap-up steppers, the dots suggestion, facilitator edit and delete in Clarify,
// "(reconnecting)" for a vanished facilitator, and ending the session early. One board.
test.setTimeout(240_000)

const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const card = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text })
const timer = (page: Page) => page.getByRole('timer')

async function axe(page: Page, what: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations.map((v) => `${what}: ${v.id} ${v.nodes.map((n) => n.target).join(', ')}`)
}

/** axe in the current theme and in the other one (prompt 7.4). */
async function axeBoth(page: Page, what: string) {
  const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ })
  const found = await axe(page, what)
  await toggle.click()
  found.push(...(await axe(page, `${what} (other theme)`)))
  await toggle.click()
  expect(found).toEqual([])
}

test('launch fixes for the facilitator controls', async ({ browser }) => {
  const franContext = await browser.newContext()
  let fran = await franContext.newPage()
  const pat = await (await browser.newContext()).newPage()
  const guards = [guard(fran), guard(pat)]

  // Lobby: the pitch timer steps 15 s down to Off, the wrap-up timer in whole minutes.
  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E launch ui-b ${Date.now()}`)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  const link = fran.url()
  await pat.goto(link)
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  await expect(pat.getByText('Waiting for Fran to start the session')).toBeVisible()

  const pitch = (page: Page) => page.getByRole('group', { name: 'Pitch' })
  const wrapup = (page: Page) => page.getByRole('group', { name: 'Wrap-up' })
  await expect(pitch(fran)).toContainText('30 s')
  await btn(fran, 'Decrease Pitch').click()
  await expect(pitch(fran)).toContainText('15 s')
  await btn(fran, 'Decrease Pitch').click()
  await expect(pitch(pat)).toContainText('Off')
  await expect(btn(fran, 'Decrease Pitch')).toBeDisabled()
  await btn(fran, 'Increase Pitch').click()
  await expect(pitch(pat)).toContainText('15 s')
  await expect(wrapup(fran)).toContainText('5:00')
  await btn(fran, 'Increase Wrap-up').click()
  await expect(wrapup(pat)).toContainText('6:00')
  await expect(btn(pat, 'Increase Wrap-up')).toBeDisabled()

  // Brainstorm opens with the clock stopped at the full time; topics can be written meanwhile.
  await fran.getByRole('button', { name: /Start brainstorm/ }).click()
  await expect(pat.getByText('The clock starts when the facilitator is ready.')).toBeVisible()
  await expect(btn(fran, 'Start the 5:00 clock')).toBeVisible()
  await expect(btn(fran, 'Pause')).toHaveCount(0)
  for (const t of ['Alpha topic', 'Bravo topic', 'Charlie topic']) {
    await pat.getByLabel('New topic').fill(t)
    await pat.getByLabel('New topic').press('Enter')
    await expect(pat.getByText(t, { exact: true })).toBeVisible()
  }
  await fran.getByLabel('New topic').fill('Delta topic')
  await fran.getByLabel('New topic').press('Enter')
  await expect(fran.getByText('4 topics so far')).toBeVisible()
  await expect(timer(pat)).toHaveAttribute('aria-label', '5 minutes 0 seconds left')
  await btn(pat, 'Edit "Alpha topic"').click()
  await expect(pat.getByText('11 of 160 characters')).toBeVisible()
  await pat.getByRole('textbox', { name: 'Edit topic' }).press('Escape')
  await axeBoth(fran, 'brainstorm stopped, facilitator')
  await axeBoth(pat, 'brainstorm stopped, participant')

  // The facilitator starts the clock, then takes a minute off.
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(pat.getByText('The clock starts when the facilitator is ready.')).toHaveCount(0)
  await expect(timer(pat)).toHaveAttribute('aria-label', /^4 minutes/)
  await expect(btn(fran, 'Start the 5:00 clock')).toHaveCount(0)
  await expect(btn(fran, 'Pause')).toBeVisible()
  await expect(btn(fran, 'Remove 1 minute')).toContainText('-1 min')
  await btn(fran, 'Remove 1 minute').click()
  await expect(timer(pat)).toHaveAttribute('aria-label', /^3 minutes/)
  await axeBoth(fran, 'brainstorm running, facilitator')

  // Clarify: the dots suggestion (4 topics / 2 = 2) replaces the default of 3.
  await btn(fran, 'End brainstorm now').click()
  await expect(fran.getByText('Suggested: 2 dots each (topics / 2, at most 5)')).toBeVisible()
  await btn(fran, 'Use 2 dots').click()
  await expect(fran.getByText(/Opens 2 dots each/)).toBeVisible()
  await expect(btn(fran, 'Use 2 dots')).toHaveCount(0)

  // Facilitator edit: inline, with a counter; Enter saves, Escape cancels.
  await card(fran, 'Alpha topic').getByRole('button', { name: 'Edit', exact: true }).click()
  const box = fran.getByRole('textbox', { name: 'Edit topic' })
  await expect(box).toBeFocused()
  await expect(fran.getByText('11 of 160 characters')).toBeVisible()
  await box.fill('Alpha topic, sharpened')
  await expect(fran.getByText('22 of 160 characters')).toBeVisible()
  await axeBoth(fran, 'clarify, editing')
  await box.press('Enter')
  await expect(pat.getByText('Alpha topic, sharpened', { exact: true })).toBeVisible()
  await card(fran, 'Bravo topic').getByRole('button', { name: 'Edit', exact: true }).click()
  await box.fill('This should not be saved')
  await box.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(
    card(fran, 'Bravo topic').getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused()

  // Facilitator delete, after a confirmation.
  await card(fran, 'Charlie topic').getByRole('button', { name: 'Delete', exact: true }).click()
  const confirmDelete = fran.getByRole('dialog', { name: 'Delete this topic?' })
  await expect(confirmDelete).toContainText('"Charlie topic" by Pat is removed for everyone.')
  expect(await axe(fran, 'clarify, delete dialog')).toEqual([])
  await confirmDelete.getByRole('button', { name: 'Delete topic' }).click()
  await expect(pat.getByText('Charlie topic', { exact: true })).toHaveCount(0)
  await expect(pat.getByText('This should not be saved')).toHaveCount(0)

  // Selecting cards for a merge still works by the card's own name.
  await fran.getByRole('button', { name: /Bravo topic/ }).click()
  await fran.getByRole('button', { name: /Delta topic/ }).click()
  await expect(btn(fran, 'Merge 2 selected')).toBeVisible()
  await btn(fran, 'Keep separate').click()

  // The pitch clock gets timer buttons in 15 s steps.
  await btn(fran, 'Start pitches').click()
  await expect(pat.getByText('PITCHING NOW')).toBeVisible()
  await expect(btn(fran, 'Add 15 seconds')).toBeVisible()
  await expect(btn(fran, 'Remove 15 seconds')).toBeVisible()
  await btn(fran, 'Pause').click()
  await expect(btn(fran, 'Resume')).toBeVisible()
  await axeBoth(fran, 'clarify, pitching')
  await btn(fran, 'Stop pitching').click()

  // The facilitator's tab closes: others see "(reconnecting)" once the 45 s window passes.
  await fran.close()
  await expect(pat.getByText('(reconnecting)')).toBeVisible({ timeout: 70_000 })
  await expect(pat.getByText('The facilitator, Fran, is reconnecting.')).toBeAttached()
  await axeBoth(pat, 'clarify, facilitator reconnecting')
  fran = await franContext.newPage()
  guards.push(guard(fran))
  await fran.goto(link)
  await expect(fran.getByText('FACILITATOR', { exact: true })).toBeVisible()
  await expect(pat.getByText('(reconnecting)')).toHaveCount(0, { timeout: 30_000 })

  // End the session from Clarify, after a confirmation that can be cancelled.
  await btn(fran, 'End session').click()
  const confirmEnd = fran.getByRole('dialog', { name: 'End the session now?' })
  await expect(confirmEnd).toContainText(
    'The board becomes read-only for everyone. Downloads stay available.',
  )
  expect(await axe(fran, 'end session dialog')).toEqual([])
  await confirmEnd.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmEnd).toBeHidden()
  await expect(btn(fran, 'End session')).toBeFocused()
  await btn(fran, 'End session').click()
  await confirmEnd.getByRole('button', { name: 'End session now' }).click()
  await expect(pat.getByRole('heading', { name: 'This session has ended' })).toBeVisible()
  await expect(pat.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
  for (const g of guards) g.check()
})
