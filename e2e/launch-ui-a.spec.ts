import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// Launch fixes on the Vote, Discuss and Board screens: downloads from the Vote reveal on, an early
// vote where everyone moves on and the facilitator extends anyway, a free-text action owner,
// skip and Bring back (spec F20), and the facilitator editing and deleting topics (F07).

/** axe in the current theme and the other one, ending where it started. */
async function axe(page: Page) {
  for (const theme of ['current', 'other']) {
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(
      violations.map((v) => `${theme}: ${v.id} ${v.nodes.map((n) => n.target.join(' '))}`),
    ).toEqual([])
    await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click()
  }
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const stage = (page: Page) => region(page, 'Now discussing')

test('skip and bring back, edit and delete, downloads, owners and the move-on override', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const fran = await (await browser.newContext()).newPage()
  const pat = await (await browser.newContext()).newPage()
  const guards = [guard(fran), guard(pat)]

  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E launch ui-a ${Date.now()}`)
  await fran.getByRole('button', { name: 'Create board' }).click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await pat.getByRole('button', { name: 'Join session' }).click()
  await expect(pat.getByText(/Waiting for Fran/)).toBeVisible()
  const start = fran.getByRole('button', { name: 'Start brainstorm for 2 people' })
  await expect(start).toBeVisible({ timeout: 20_000 })
  await start.click()

  // Topics can be written while the brainstorm clock is still stopped (D64).
  for (const t of ['Alpha topic', 'Bravo topic', 'Charlie topic', 'Delta topic']) {
    await fran.getByLabel('New topic').fill(t)
    await fran.getByLabel('New topic').press('Enter')
    await expect(fran.getByText(t, { exact: true })).toBeVisible()
  }
  await fran.getByRole('button', { name: 'End brainstorm now' }).click()
  await fran.getByRole('button', { name: 'Continue to voting' }).click()
  await fran.getByRole('button', { name: 'Reveal results now' }).click()

  // Downloads appear for everyone once the votes are revealed (F24).
  await expect(pat.getByRole('heading', { name: 'Here is the agenda' })).toBeVisible()
  for (const page of [fran, pat]) {
    await expect(page.getByRole('heading', { name: 'Download the results' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Download Excel file' })).toBeEnabled()
  }
  const [file] = await Promise.all([
    pat.waitForEvent('download'),
    pat.getByRole('button', { name: 'Download Excel file' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^E2E launch ui-a \d+ \d{4}-\d{2}-\d{2}\.xlsx$/)
  await fran.getByRole('button', { name: 'Start discussing' }).click()
  await fran.getByRole('button', { name: /Start the .* clock/ }).click()
  await expect(stage(pat)).toContainText('Alpha topic')

  // An early vote where everyone moves on clears the stage; the facilitator can extend anyway.
  await fran.getByRole('button', { name: 'Call vote now' }).click()
  for (const page of [fran, pat]) await page.getByRole('button', { name: /^Move on/ }).click()
  await expect(pat.getByText('The group chose to move on.')).toBeVisible()
  await expect(pat.getByText('DISCUSSING NOW')).toHaveCount(0)
  await expect(pat.getByText('UP NEXT', { exact: true })).toBeVisible()
  await expect(pat.getByRole('button', { name: /anyway/ })).toHaveCount(0)
  await axe(pat)
  await fran.getByRole('button', { name: 'Extend 3:00 anyway' }).click()
  await expect(stage(pat)).toContainText('Alpha topic')
  await expect(pat.getByText('Extended ×1')).toBeVisible()

  // The action owner is free text, with participants suggested (F22).
  await pat.getByLabel('New action').fill('Write up the alpha plan')
  await pat.getByLabel('Action owner').fill('Someone in finance')
  await pat.getByRole('button', { name: 'Add action' }).click()
  await expect(fran.getByText('Write up the alpha plan')).toBeVisible()
  await expect(fran.getByText('Someone in finance', { exact: true })).toBeVisible()
  await expect(pat.getByLabel('Action owner')).toHaveValue('')

  // Skip: the topic stays visible to everyone under Skipped.
  await fran.getByRole('button', { name: 'Skip', exact: true }).click()
  const patSide = pat.getByRole('complementary', { name: 'Session controls' })
  await expect(patSide.getByText('Skipped', { exact: true })).toBeVisible()
  await expect(patSide.getByText('Alpha topic', { exact: true })).toBeVisible()
  await expect(pat.getByRole('button', { name: /^Bring back/ })).toHaveCount(0)
  await fran.getByRole('button', { name: /Start the .* clock/ }).click()
  await expect(stage(pat)).toContainText('Bravo topic')

  // Board tab: downloads and Skipped for everyone; edit and delete for the facilitator only.
  for (const page of [fran, pat])
    await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(region(pat, 'Skipped')).toContainText('Alpha topic')
  await expect(pat.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
  await expect(pat.getByRole('button', { name: /^(Edit|Delete|Bring back) "/ })).toHaveCount(0)
  const onStage = region(fran, 'Discussing')
  await expect(onStage.getByRole('button', { name: 'Edit "Bravo topic"' })).toBeVisible()
  await expect(onStage.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await axe(fran)

  const queue = region(fran, 'To discuss')
  await queue.getByRole('button', { name: 'Edit "Charlie topic"' }).click()
  const edit = fran.getByRole('textbox', { name: 'Edit topic' })
  await expect(edit).toBeFocused()
  await expect(edit).toHaveAccessibleDescription('13 of 160 characters')
  await edit.fill('Charlie topic, revised')
  await expect(edit).toHaveAccessibleDescription('22 of 160 characters')
  await edit.press('Enter')
  await expect(region(pat, 'To discuss')).toContainText('Charlie topic, revised')

  // Escape cancels and returns focus to the Edit button.
  await queue.getByRole('button', { name: 'Edit "Delta topic"' }).click()
  await edit.fill('Not saved')
  await edit.press('Escape')
  await expect(edit).toHaveCount(0)
  await expect(queue.getByRole('button', { name: 'Edit "Delta topic"' })).toBeFocused()

  await onStage.getByRole('button', { name: 'Edit "Bravo topic"' }).click()
  await edit.fill('Bravo, renamed on stage')
  await fran.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(region(pat, 'Discussing')).toContainText('Bravo, renamed on stage')

  await queue.getByRole('button', { name: 'Delete "Delta topic"' }).click()
  const dialog = fran.getByRole('dialog', { name: 'Delete this topic?' })
  await expect(dialog).toContainText('Delta topic')
  await dialog.getByRole('button', { name: 'Delete topic' }).click()
  await expect(dialog).toBeHidden()
  await expect(pat.getByText('Delta topic', { exact: true })).toHaveCount(0)

  // Bring back puts the skipped topic at the bottom of the queue.
  await region(fran, 'Skipped').getByRole('button', { name: 'Bring back "Alpha topic"' }).click()
  await expect(region(pat, 'Skipped')).toHaveCount(0)
  await expect(region(pat, 'To discuss').getByRole('listitem').last()).toContainText('Alpha topic')
  await expect(patSide.getByText('Skipped', { exact: true })).toHaveCount(0)

  for (const g of guards) g.check()
})
