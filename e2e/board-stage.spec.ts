import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// Discuss as the board (option 3): what is next, what is on stage and what is done on one screen
// at the Teams share size. Screenshots go to test-results/screens/board-stage for review.
test.setTimeout(300_000)

const SHARE = { width: 1280, height: 720 }
const SIZES = [
  [1280, 720],
  [1440, 900],
] as const
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const themeToggle = (page: Page) =>
  page.getByRole('button', { name: /Switch to (dark|light) mode/ })

/** axe in light and dark, ending in the theme it started in (prompt 7.4). */
async function axeBoth(page: Page, what: string) {
  const found: string[] = []
  for (const theme of ['current', 'other']) {
    const { violations } = await new AxeBuilder({ page }).analyze()
    found.push(
      ...violations.map((v) => `${what} (${theme}): ${v.id} ${v.nodes.map((n) => n.target)}`),
    )
    await themeToggle(page).click()
  }
  expect(found).toEqual([])
}

/** Screenshots in light and dark at the share sizes, back at 1280 x 720 in the light theme. */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height })
      await page.screenshot({
        path: `test-results/screens/board-stage/${name}-${theme}-${width}x${height}.png`,
      })
    }
    await themeToggle(page).click()
  }
  await page.setViewportSize(SHARE)
}

/** Teams legibility at 1280 x 720 (build prompt section 3): sizes as rendered, no sideways scroll. */
async function legibility(page: Page) {
  return page.evaluate(() => {
    const size = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0)
    let smallest = Infinity
    for (const el of document.querySelectorAll('main *, header *, nav *')) {
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
      if (!text || el.closest('.sr-only, dialog:not([open])')) continue
      if (el.getBoundingClientRect().width > 0) smallest = Math.min(smallest, size(el))
    }
    return {
      topic: size(document.querySelector('main h1')),
      digits: size(document.querySelector('[role="timer"] span')),
      smallest,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
}

test('the Discuss board: progress, stage and history on one screen', async ({ browser }) => {
  const fran = await (await browser.newContext({ viewport: SHARE })).newPage()
  const pat = await (await browser.newContext({ viewport: SHARE })).newPage()
  const guards = [guard(fran), guard(pat)]

  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E board stage ${Date.now()}`)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  await expect(pat.getByText(/Waiting for Fran/)).toBeVisible()
  const start = btn(fran, 'Start brainstorm for 2 people')
  await expect(start).toBeVisible({ timeout: 20_000 })
  await start.click()

  const topics: [Page, string][] = [
    [pat, 'How do we onboard remote hires in their first two weeks?'],
    [pat, 'AI tools: what is actually saving us time?'],
    [fran, 'Making async updates actually get read'],
    [fran, 'Saying no to stakeholders without burning trust'],
    [pat, 'Pairing vs. async code review'],
    [fran, 'Scope creep on fixed-price projects'],
    [fran, 'Where should decisions get written down?'],
  ]
  for (const [page, text] of topics) {
    await page.getByLabel('New topic').fill(text)
    await page.getByLabel('New topic').press('Enter')
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  await btn(fran, 'End brainstorm now').click()
  await btn(fran, 'Skip pitches').click()
  // Nobody can dot their own topic, so Fran's dots set the order: onboarding, then AI tools.
  // Each dot is saved before the next click, so none is still in flight when voting closes.
  for (const i of [0, 0, 1])
    await Promise.all([
      fran.waitForResponse((r) => r.url().includes('/rpc/cast_dots') && r.ok()),
      btn(fran, `Add a dot to "${topics[i]?.[1]}"`).click(),
    ])
  for (const page of [fran, pat]) await btn(page, "I'm done").click()
  await expect(pat.getByRole('heading', { name: 'Here is the agenda' })).toBeVisible()
  await btn(fran, 'Start discussing').click()

  // Between topics the stage shows what is up next; the facilitator starts the clock.
  const [onboard, ai, async, sayNo, pairing, scope, decisions] = topics.map(([, t]) => t)
  await expect(region(pat, 'Discussing')).toContainText('UP NEXT')
  await expect(pat.getByRole('heading', { level: 1, name: onboard })).toBeVisible()
  await expect(pat.getByText('0 of 7 discussed')).toBeVisible()
  await btn(fran, 'Start the 5:00 clock').click()

  // Progress is on screen during the discussion, for everyone.
  await expect(region(pat, 'Discussing')).toContainText('DISCUSSING NOW')
  await expect(pat.getByText('Topic 1 of 7')).toBeVisible()
  await expect(pat.getByText(/^\d+ of 75 min$/)).toBeVisible()
  await expect(pat.getByText(/more topics? fit/)).toBeVisible()
  await pat.getByLabel('New action').fill('Draft a two-week onboarding checklist')
  await pat.getByLabel('Action owner').fill('Maya')
  await btn(pat, 'Add action').click()
  await expect(region(fran, 'Discussing')).toContainText('Draft a two-week onboarding checklist')

  // Next topic: the card moves to Discussed with its time, votes and action; focus goes to the
  // stage heading, as the pressed button has gone.
  await btn(fran, 'Next topic').click()
  const done = region(pat, 'Discussed')
  await expect(done.getByRole('listitem').first()).toContainText(onboard)
  await expect(done.getByRole('listitem').first()).toContainText('2 votes')
  await expect(done).toContainText('Draft a two-week onboarding checklist · Maya')
  await expect(done).toContainText('1 action in all')
  await expect(fran.getByRole('heading', { level: 1, name: ai })).toBeFocused()
  await expect(pat.getByRole('status').filter({ hasText: 'moved to Discussed after' })).toHaveCount(
    1,
  )

  // An extension by vote, then the mid-topic board for the screenshots.
  await btn(fran, 'Start the 5:00 clock').click()
  await btn(fran, 'Call vote now').click()
  for (const page of [fran, pat]) await page.getByRole('button', { name: /^Keep going/ }).click()
  await expect(pat.getByText('The group chose to keep going: 3:00 added.')).toBeVisible()
  await expect(pat.getByText('Extended ×1')).toBeVisible()
  await pat.getByLabel('New action').fill('Compare meeting-notes tools on one real call')
  await pat.getByLabel('Action owner').fill('Leo')
  await btn(pat, 'Add action').click()
  await expect(region(pat, 'Extend vote')).toHaveCount(0, { timeout: 20_000 })

  for (const page of [fran, pat]) {
    await page.evaluate(() => window.scrollTo(0, 0))
    const sizes = await legibility(page)
    expect(sizes.topic).toBeGreaterThanOrEqual(44)
    expect(sizes.digits).toBeGreaterThanOrEqual(64)
    expect(sizes.smallest).toBeGreaterThanOrEqual(13)
    expect(sizes.sideways).toBe(false)
    // What is next, what is on, and what is done, all inside the 720 px share.
    for (const name of ['To discuss', 'Discussing', 'Discussed']) {
      const box = await region(page, name).boundingBox()
      expect(box?.y ?? 720).toBeLessThan(300)
    }
    await expect(page.getByLabel('New action')).toBeInViewport()
  }
  await shoot(fran, 'mid-topic-facilitator')
  await shoot(pat, 'mid-topic-participant')
  await axeBoth(fran, 'mid-topic, facilitator')
  await axeBoth(pat, 'mid-topic, participant')

  // Phones: the stage first, then To discuss, then Discussed; nothing scrolls sideways.
  for (const [page, who] of [
    [pat, 'participant'],
    [fran, 'facilitator'],
  ] as const) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect((await legibility(page)).sideways).toBe(false)
    const order = await Promise.all(
      ['Discussing', 'To discuss', 'Discussed'].map(
        async (name) => (await region(page, name).boundingBox())?.y ?? 0,
      ),
    )
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    const path = `test-results/screens/board-stage/phone-${who}-390`
    await page.screenshot({ path: `${path}x844.png` })
    await page.screenshot({ path: `${path}-full.png`, fullPage: true })
    await page.setViewportSize(SHARE)
  }

  // Participants see the same board with none of the facilitator's controls.
  await expect(pat.getByRole('heading', { level: 1, name: ai })).toBeVisible()
  for (const name of [
    /^Pause$/,
    /^Remove 1 minute$/,
    /^Call vote now$/,
    /^Next topic$/,
    /^Defer to later$/,
    /^Skip$/,
    /^(Edit|Delete|Move|Bring back) /,
  ])
    await expect(pat.getByRole('button', { name })).toHaveCount(0)

  // The people dialog: the facilitator's tools; Escape returns focus to the toolbar button.
  await btn(fran, '2 people').click()
  const people = fran.getByRole('dialog', { name: 'People' })
  for (const name of ['Pass facilitator role', 'Manage people', 'End session'])
    await expect(btn(fran, name)).toBeVisible()
  await expect(people.getByRole('list', { name: 'People connected' })).toContainText('Pat')
  await expect(people).toContainText('Fran (you)')
  await fran.screenshot({ path: 'test-results/screens/board-stage/people-dialog-1280x720.png' })
  expect((await new AxeBuilder({ page: fran }).analyze()).violations).toEqual([])
  await fran.keyboard.press('Escape')
  await expect(people).toBeHidden()
  await expect(btn(fran, '2 people')).toBeFocused()
  await btn(pat, '2 people').click()
  await expect(pat.getByRole('dialog', { name: 'People' })).toContainText('Fran')
  await expect(btn(pat, 'Pass facilitator role')).toHaveCount(0)
  await expect(btn(pat, 'End session')).toHaveCount(0)
  await btn(pat, 'Done').click()

  // The downloads dialog, for everyone.
  await btn(pat, 'Downloads').click()
  const downloads = pat.getByRole('dialog', { name: 'Download the results' })
  await expect(downloads).toBeVisible()
  const [file] = await Promise.all([
    pat.waitForEvent('download'),
    downloads.getByRole('button', { name: 'Download Word file' }).click(),
  ])
  expect(file.suggestedFilename()).toMatch(/^E2E board stage \d+ \d{4}-\d{2}-\d{2}\.docx$/)
  await pat.screenshot({ path: 'test-results/screens/board-stage/downloads-dialog-1280x720.png' })
  await downloads.getByRole('button', { name: 'Done' }).click()
  await expect(btn(pat, 'Downloads')).toBeFocused()

  // Between topics: the extended topic is in Discussed with its action underneath.
  await btn(fran, 'Next topic').click()
  await expect(done).toContainText('extended once')
  await expect(done).toContainText('Compare meeting-notes tools on one real call · Leo')
  await expect(done).toContainText('2 actions in all')
  await expect(pat.getByText('Waiting for the facilitator to start the next topic.')).toBeVisible()
  await shoot(fran, 'between-topics-facilitator')
  await shoot(pat, 'between-topics-participant')

  // Skip: the topic stays on the board under Skipped, and only the facilitator can bring it back.
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(pat.getByRole('heading', { level: 1, name: async })).toBeVisible()
  await btn(fran, 'Skip').click()
  const queue = region(fran, 'To discuss')
  const patQueue = region(pat, 'To discuss')
  await expect(patQueue.getByRole('heading', { name: 'Skipped 1' })).toBeVisible()
  await expect(patQueue.getByRole('list', { name: 'Skipped 1' })).toContainText(async)
  await expect(pat.getByRole('button', { name: /^Bring back/ })).toHaveCount(0)
  await expect(pat.getByRole('status').filter({ hasText: 'was skipped' })).toHaveCount(1)

  // The facilitator edits and deletes from the To discuss column.
  await queue.getByRole('button', { name: `Edit "${scope}"` }).click()
  const edit = fran.getByRole('textbox', { name: 'Edit topic' })
  await expect(edit).toBeFocused()
  await edit.fill('Scope creep on fixed-price work')
  await edit.press('Enter')
  await expect(patQueue).toContainText('Scope creep on fixed-price work')
  await expect(
    queue.getByRole('button', { name: 'Edit "Scope creep on fixed-price work"' }),
  ).toBeFocused()
  await queue.getByRole('button', { name: `Edit "${decisions}"` }).click()
  await edit.fill('Not saved')
  await edit.press('Escape')
  await expect(queue.getByRole('button', { name: `Edit "${decisions}"` })).toBeFocused()
  await queue.getByRole('button', { name: `Delete "${pairing}"` }).click()
  const confirm = fran.getByRole('dialog', { name: 'Delete this topic?' })
  await expect(confirm).toContainText(pairing)
  await confirm.getByRole('button', { name: 'Delete topic' }).click()
  await expect(patQueue).not.toContainText(pairing)
  await expect(queue.getByRole('heading', { level: 2 })).toBeFocused()
  await axeBoth(fran, 'skipped and edited, facilitator')

  // Bring back puts the skipped topic at the end of the queue and focus on the queue.
  await queue.getByRole('button', { name: `Bring back "${async}"` }).click()
  await expect(patQueue.getByRole('heading', { name: /^Skipped/ })).toHaveCount(0)
  await expect(patQueue.getByRole('list').first().getByRole('listitem').last()).toContainText(async)
  await expect(queue.getByRole('list').first()).toBeFocused()

  // An early vote where everyone moves on: the result stays between topics, with the
  // facilitator's override.
  await expect(region(fran, 'Discussing')).toContainText(sayNo)
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(pat.getByRole('heading', { level: 1, name: sayNo })).toBeVisible()
  await btn(fran, 'Call vote now').click()
  for (const page of [fran, pat]) await page.getByRole('button', { name: /^Move on/ }).click()
  await expect(pat.getByText('The group chose to move on.')).toBeVisible()
  await expect(region(pat, 'Discussing')).not.toContainText('DISCUSSING NOW')
  await expect(region(pat, 'Discussing')).toContainText('UP NEXT')
  await expect(pat.getByRole('button', { name: /anyway/ })).toHaveCount(0)
  await expect(btn(fran, 'Extend 3:00 anyway')).toBeVisible()
  await expect(done.getByRole('listitem').filter({ hasText: sayNo })).toHaveCount(1)
  await shoot(fran, 'moved-on-facilitator')
  await shoot(pat, 'moved-on-participant')
  await axeBoth(fran, 'moved on, facilitator')
  await axeBoth(pat, 'moved on, participant')

  for (const g of guards) g.check()
})
