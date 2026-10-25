import { expect, test, type Locator, type Page } from '@playwright/test'

/** Presses Tab until the target has focus (proving it is reachable by keyboard), then a key. */
async function tabTo(page: Page, target: Locator, key?: string): Promise<void> {
  await target.waitFor()
  for (let i = 0; i < 120; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      if (key) await page.keyboard.press(key)
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error(`Could not reach ${String(target)} with Tab`)
}

async function typeInto(page: Page, target: Locator, text: string, submit = false) {
  await tabTo(page, target)
  await page.keyboard.type(text)
  if (submit) await page.keyboard.press('Enter')
}

// Prompt 7.4: a whole session completed with the keyboard only, by facilitator and participant.
test('a session can be run from start to end with the keyboard alone', async ({ browser }) => {
  test.setTimeout(180_000)
  const fran = await (await browser.newContext()).newPage()
  const pat = await (await browser.newContext()).newPage()
  const btn = (page: Page, name: string | RegExp) =>
    page.getByRole('button', { name, exact: typeof name === 'string' })

  await fran.goto('/')
  await typeInto(fran, fran.getByLabel('Name', { exact: true }), 'Fran')
  await typeInto(fran, fran.getByLabel('Name this session'), `E2E keyboard ${Date.now()}`)
  await tabTo(fran, btn(fran, 'Create board'), 'Enter')
  await expect(fran.getByTestId('room-code')).toBeVisible()

  await pat.goto(fran.url())
  await typeInto(pat, pat.getByLabel('Name', { exact: true }), 'Pat', true)
  await expect(pat.getByText(/Waiting for Fran/)).toBeVisible()

  await tabTo(fran, btn(fran, 'Start brainstorm for 2 people'), 'Enter')
  await typeInto(pat, pat.getByLabel('New topic'), 'Keyboard-only topic', true)
  await typeInto(fran, fran.getByLabel('New topic'), 'Facilitator topic', true)
  await expect(pat.getByText('Keyboard-only topic', { exact: true })).toBeVisible()
  await tabTo(fran, btn(fran, 'End brainstorm now'), 'Enter')
  await tabTo(fran, btn(fran, 'Continue to voting'), 'Enter')

  await tabTo(fran, btn(fran, 'Add a dot to "Keyboard-only topic"'), 'Enter')
  await tabTo(pat, btn(pat, 'Add a dot to "Facilitator topic"'), 'Space')
  await tabTo(fran, btn(fran, "I'm done"), 'Enter')
  await tabTo(pat, btn(pat, "I'm done"), 'Enter')
  await tabTo(fran, btn(fran, 'Start discussing'), 'Enter')
  await tabTo(fran, btn(fran, /Start the .* clock/), 'Enter')
  await expect(pat.getByText('DISCUSSING NOW')).toBeVisible()

  // The people dialog opens from the toolbar; the handover dialog opens inside it. Each takes
  // focus, Escape closes the top one, and focus returns to its opener.
  const people = btn(fran, '2 people')
  await tabTo(fran, people, 'Enter')
  await expect(fran.getByRole('dialog', { name: 'People' })).toBeVisible()
  const opener = btn(fran, 'Pass facilitator role')
  await tabTo(fran, opener, 'Enter')
  await expect(fran.getByRole('dialog', { name: 'Pass the facilitator role' })).toBeVisible()
  expect(await fran.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  await fran.keyboard.press('Escape')
  await expect(fran.getByRole('dialog', { name: 'Pass the facilitator role' })).toHaveCount(0)
  await expect(opener).toBeFocused()
  await fran.keyboard.press('Escape')
  await expect(fran.getByRole('dialog')).toHaveCount(0)
  await expect(people).toBeFocused()

  await tabTo(fran, btn(fran, 'Call vote now'), 'Enter')
  await tabTo(pat, pat.getByRole('button', { name: /^Keep going/ }), 'Space')
  await tabTo(fran, fran.getByRole('button', { name: /^Move on/ }), 'Enter')
  // A Move on vote takes the topic off stage by itself (decision D60).
  await expect(pat.getByText('The group chose to move on.')).toBeVisible()
  await tabTo(fran, btn(fran, 'Start wrap-up').first(), 'Enter')

  await typeInto(pat, pat.getByLabel('Your take-away'), 'Keyboards are enough.', true)
  await expect(fran.getByText('Keyboards are enough.')).toBeVisible()
  await tabTo(fran, btn(fran, 'End session'), 'Enter')
  await expect(pat.getByRole('heading', { name: 'This session has ended' })).toBeVisible()
})
