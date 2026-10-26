import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// Brainstorm and Clarify on the board (option 3): To discuss on the left, the stage in the middle
// and Discussed on the right, as in Discuss. Screenshots go to E2E_SHOTS, or
// test-results/screens/board-phases-a, for review.
test.setTimeout(420_000)

const SHOTS = process.env.E2E_SHOTS ?? 'test-results/screens/board-phases-a'
const SHARE = { width: 1280, height: 720 }
const SIZES = [
  [1280, 720],
  [1440, 900],
] as const
// The longest topic the database takes (160 characters).
const LONG =
  'How do we make sure the written async updates we post every Friday actually get read by the people who need them and then get acted on before the next planning?'
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
// The phase's live line is the last status in the page's main; the people button has one too.
const live = (page: Page) => page.getByRole('main').getByRole('status').last()
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
      await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${width}x${height}.png` })
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
      heading: size(document.querySelector('main h1')),
      digits: size(document.querySelector('[role="timer"] span')),
      smallest,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
}

/** The share at 1280 x 720: the three columns start near the top and the sizes hold. */
async function onTheShare(page: Page, stage: string, heading: number) {
  await page.setViewportSize(SHARE)
  await page.evaluate(() => window.scrollTo(0, 0))
  const sizes = await legibility(page)
  expect(sizes.heading).toBeGreaterThanOrEqual(heading)
  expect(sizes.digits).toBeGreaterThanOrEqual(64)
  expect(sizes.smallest).toBeGreaterThanOrEqual(13)
  expect(sizes.sideways).toBe(false)
  for (const name of ['To discuss', stage, 'Discussed']) {
    const box = await region(page, name).boundingBox()
    expect(box?.y ?? 720).toBeLessThan(300)
  }
  await expect(page.getByRole('timer')).toBeInViewport({ ratio: 1 })
}

/** Phones: the stage first, then To discuss, then Discussed, in the page as on the screen. */
async function phoneOrder(page: Page, stage: string, name: string) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  expect((await legibility(page)).sideways).toBe(false)
  const order = await Promise.all(
    [stage, 'To discuss', 'Discussed'].map(
      async (n) => (await region(page, n).boundingBox())?.y ?? 0,
    ),
  )
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  const named = () =>
    page
      .getByRole('main')
      .getByRole('region')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  await expect.poll(named).toEqual([stage, 'To discuss', 'Discussed'])
  await page.screenshot({ path: `${SHOTS}/${name}-phone-390x844.png` })
  await page.screenshot({ path: `${SHOTS}/${name}-phone-390-full.png`, fullPage: true })
  await page.setViewportSize(SHARE)
  await expect.poll(named).toEqual(['To discuss', stage, 'Discussed'])
}

test('Brainstorm and Clarify as the board', async ({ browser }) => {
  const fran = await (await browser.newContext({ viewport: SHARE })).newPage()
  const pat = await (await browser.newContext({ viewport: SHARE })).newPage()
  const guards = [guard(fran), guard(pat)]

  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E board phases a ${Date.now()}`)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  await expect(pat.getByText(/Waiting for Fran/)).toBeVisible()
  const start = btn(fran, 'Start brainstorm for 2 people')
  // A freshly started local Realtime can take a while to stream changes; see full-session.
  await expect(start).toBeVisible({ timeout: 45_000 })
  await start.click()

  // Brainstorm, clock stopped (D64): the board is there from the start, with the clock on stage.
  await expect(pat.getByText('The clock starts when the facilitator is ready.')).toBeVisible()
  await expect(btn(fran, 'Start the 5:00 clock')).toBeVisible()
  const patTopics = [
    'How do we onboard remote hires in their first two weeks?',
    'AI tools: what is actually saving us time?',
    'Pairing vs. async code review',
  ]
  const franTopics = [
    'Making async updates actually get read',
    'Saying no to stakeholders without burning trust',
  ]
  for (const text of patTopics) {
    await pat.getByLabel('New topic').fill(text)
    await pat.getByLabel('New topic').press('Enter')
    await expect(region(pat, 'To discuss').getByText(text, { exact: true })).toBeVisible()
  }
  await expect(live(pat)).toHaveText(`Added "${patTopics[2]}". 3 of 5 used.`)
  await expect(pat.getByLabel('New topic')).toBeFocused()
  await expect(pat.getByLabel('New topic')).toHaveAccessibleDescription(
    '0 of 160 characters · 3 of 5 used · Press Enter to add',
  )
  const [addRequest] = await Promise.all([
    fran.waitForRequest((r) => r.url().includes('/rpc/add_topic')),
    (async () => {
      await fran.getByLabel('New topic').fill(franTopics[0] ?? '')
      await fran.getByLabel('New topic').press('Enter')
    })(),
  ])
  const boardId = (JSON.parse(addRequest.postData() ?? '{}') as { p_board: string }).p_board
  await fran.getByLabel('New topic').fill(franTopics[1] ?? '')
  await fran.getByLabel('New topic').press('Enter')

  // Others' cards are face down: the count comes from the board, their words never reach Pat.
  const patColumn = region(pat, 'To discuss')
  await expect(pat.getByText('5 topics so far')).toBeVisible()
  await expect(patColumn.getByRole('heading', { level: 2 })).toHaveText('To discuss 5')
  await expect(patColumn.getByRole('listitem')).toHaveCount(3)
  await expect(patColumn.getByText('YOURS')).toHaveCount(3)
  await expect(patColumn.getByText('Face down until Clarify')).toHaveCount(2)
  await expect(patColumn).toContainText('2 from others, hidden until Clarify')
  expect(await pat.content()).not.toContain(franTopics[0])
  await expect(region(pat, 'Discussed').getByRole('heading', { level: 2 })).toHaveText(
    'Discussed 0',
  )
  for (const page of [fran, pat]) await onTheShare(page, 'Brainstorm', 32)
  await expect(btn(fran, 'Start the 5:00 clock')).toBeInViewport({ ratio: 1 })
  await expect(btn(fran, 'Add topic')).toBeInViewport({ ratio: 1 })
  await expect(pat.getByLabel('New topic')).toBeInViewport({ ratio: 1 })
  await expect(btn(pat, 'Add topic')).toBeInViewport({ ratio: 1 })
  await shoot(fran, 'brainstorm-stopped-facilitator')
  await shoot(pat, 'brainstorm-stopped-participant')
  await axeBoth(fran, 'brainstorm stopped, facilitator')
  await axeBoth(pat, 'brainstorm stopped, participant')

  // The facilitator starts the clock: focus moves to Pause and Pat hears it once.
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(btn(fran, 'Pause')).toBeFocused()
  await expect(live(pat)).toHaveText('The clock has started.')
  await expect(pat.getByText('The clock starts when the facilitator is ready.')).toHaveCount(0)
  await expect(fran.getByLabel('New topic')).toBeInViewport({ ratio: 1 })

  // Your cards keep Edit and Delete; Escape returns to Edit, a delete to the column heading.
  const edit = pat.getByRole('textbox', { name: 'Edit topic' })
  await btn(pat, `Edit "${patTopics[2]}"`).click()
  await expect(edit).toBeFocused()
  await expect(edit).toHaveAccessibleDescription('29 of 160 characters')
  await edit.press('Escape')
  await expect(btn(pat, `Edit "${patTopics[2]}"`)).toBeFocused()
  await btn(pat, `Edit "${patTopics[2]}"`).click()
  await edit.fill('Pairing or async code review?')
  await edit.press('Enter')
  await expect(btn(pat, 'Edit "Pairing or async code review?"')).toBeFocused()
  await btn(pat, 'Delete "Pairing or async code review?"').click()
  await expect(patColumn.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(live(pat)).toHaveText('"Pairing or async code review?" was deleted.')
  await expect(patColumn.getByRole('heading', { level: 2 })).toHaveText('To discuss 4')
  await pat.getByLabel('New topic').fill(patTopics[2] ?? '')
  await pat.getByLabel('New topic').press('Enter')
  await expect(patColumn.getByText(patTopics[2] ?? '', { exact: true })).toBeVisible()
  for (const page of [fran, pat]) await onTheShare(page, 'Brainstorm', 32)
  await expect(btn(fran, 'Pause')).toBeInViewport({ ratio: 1 })
  await shoot(fran, 'brainstorm-running-facilitator')
  await shoot(pat, 'brainstorm-running-participant')
  await axeBoth(fran, 'brainstorm running, facilitator')
  await phoneOrder(pat, 'Brainstorm', 'brainstorm-participant')
  await phoneOrder(fran, 'Brainstorm', 'brainstorm-facilitator')

  // With hide topics off, the database returns everyone's cards and they show face up.
  const token = await fran.evaluate(() => {
    const k = Object.keys(localStorage).find((name) => name.endsWith('-auth-token')) ?? ''
    return (JSON.parse(localStorage.getItem(k) ?? '{}') as { access_token: string }).access_token
  })
  await fran.evaluate(
    async ({ url, key, token, board }) => {
      const res = await fetch(`${url}/rest/v1/rpc/update_settings`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_board: board, p_settings: { hide_topics: false } }),
      })
      if (!res.ok) throw new Error(`update_settings ${res.status}`)
    },
    {
      url: process.env.VITE_SUPABASE_URL ?? '',
      key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
      token,
      board: boardId,
    },
  )
  await expect(patColumn.getByText(franTopics[0] ?? '', { exact: true })).toBeVisible()
  await expect(patColumn.getByRole('listitem')).toHaveCount(5)
  await expect(patColumn.getByText('Face down until Clarify')).toHaveCount(0)
  await expect(patColumn.getByRole('listitem').filter({ hasText: franTopics[0] })).toContainText(
    'Fran',
  )
  await expect(btn(pat, `Edit "${franTopics[0]}"`)).toHaveCount(0)
  await shoot(pat, 'brainstorm-face-up-participant')
  await axeBoth(pat, 'brainstorm face up, participant')

  // Clarify: every card face up in To discuss; the stage says how to tidy up.
  await btn(fran, 'End brainstorm now').click()
  const franColumn = region(fran, 'To discuss')
  const patStage = region(pat, 'Clarify')
  const franStage = region(fran, 'Clarify')
  await expect(pat.getByRole('heading', { level: 1 })).toHaveText(
    'Here is everything the group wrote',
  )
  await expect(patColumn.getByRole('heading', { level: 2 })).toHaveText('To discuss 5')
  await expect(franStage).toContainText('To tidy up')
  await expect(patStage).toContainText('The facilitator starts the pitches')
  // Five cards suggest three dots each, the default already.
  await expect(franStage.getByRole('button', { name: 'Using 3 dots' })).toBeDisabled()
  await shoot(fran, 'clarify-tidy-facilitator')
  await shoot(pat, 'clarify-tidy-participant')

  // Merge: select two cards, the merge is on stage; it stacks the card under the first one.
  const [onboard, ai, pairing] = patTopics as [string, string, string]
  const [async, sayNo] = franTopics as [string, string]
  // The card is the select button; Edit and Delete are named "Edit "topic"" and so on.
  await fran.getByRole('button', { name: new RegExp(`^${async.replace(/[.?]/g, '\\$&')}`) }).click()
  await expect(franStage).toContainText(`Selected "${async}". Select one more card`)
  await fran.getByRole('button', { name: /^Pairing vs\. async code review/ }).click()
  await expect(live(fran)).toHaveText(
    'Two cards selected. Merge them or keep them separate on the stage.',
  )
  await expect(fran.getByRole('heading', { level: 1 })).toHaveText('Merge these two?')
  await expect(franStage).toContainText(`KEEPS ITS PLACE${async}Fran`)
  await expect(franStage).toContainText(`JOINS IT${pairing}Pat`)
  await expect(fran.getByRole('button', { name: /async/, pressed: true })).toHaveCount(2)
  await shoot(fran, 'clarify-merge-facilitator')
  await axeBoth(fran, 'clarify merge, facilitator')
  await btn(fran, 'Merge 2 selected').click()
  await expect(fran.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(fran.getByRole('heading', { level: 1 })).toHaveText(
    'Here is everything the group wrote',
  )
  const stack = patColumn.getByRole('list', { name: `Merged into "${async}"` })
  await expect(stack).toContainText(`+ ${pairing} (Pat)`)
  await expect(live(pat)).toHaveText(`"${pairing}" was merged into "${async}".`)
  await expect(patColumn.getByRole('heading', { level: 2 })).toHaveText('To discuss 4')
  await expect(fran.getByText('4 topics · 1 card merged')).toBeVisible()
  await expect(btn(pat, 'Undo merge')).toHaveCount(0)
  await shoot(pat, 'clarify-merged-participant')
  await axeBoth(pat, 'clarify merged, participant')
  await btn(fran, 'Undo merge').click()
  await expect(stack).toHaveCount(0)
  await expect(live(pat)).toHaveText(`"${pairing}" is a card of its own again.`)
  // Undo merge leaves with the stack; focus goes to the card that came out of it.
  await expect(fran.getByRole('button', { name: /^Pairing vs\. async code review/ })).toBeFocused()

  // Pitches: the card being pitched is the page heading at 44 px with its soft clock.
  await btn(fran, 'Start pitches').click()
  await expect(fran.getByRole('heading', { level: 1, name: onboard })).toBeFocused()
  await expect(pat.getByRole('heading', { level: 1, name: onboard })).toBeVisible()
  await expect(patStage).toContainText('PITCH 1 OF 5')
  await expect(patStage).toContainText('Pat is pitching')
  await expect(live(pat)).toHaveText(`Pat is pitching "${onboard}".`)
  await expect(patColumn.getByRole('listitem').filter({ hasText: onboard })).toContainText(
    'PITCHING NOW',
  )
  await btn(fran, 'Next pitch').click()
  await expect(pat.getByRole('heading', { level: 1, name: ai })).toBeVisible()
  await expect(btn(fran, 'Next pitch')).toBeFocused()
  await expect(live(pat)).toHaveText(`Pat is pitching "${ai}".`)
  await expect(btn(fran, 'Add 15 seconds')).toBeVisible()
  await expect(btn(fran, 'Stop pitching')).toBeVisible()
  await expect(btn(fran, 'Skip pitches')).toHaveCount(0)
  for (const page of [fran, pat]) await onTheShare(page, 'Clarify', 44)
  await expect(btn(fran, 'Next pitch')).toBeInViewport({ ratio: 1 })
  await expect(btn(fran, 'Continue to voting')).toBeInViewport({ ratio: 1 })
  await shoot(fran, 'clarify-pitching-facilitator')
  await shoot(pat, 'clarify-pitching-participant')
  await axeBoth(fran, 'clarify pitching, facilitator')
  await axeBoth(pat, 'clarify pitching, participant')
  await phoneOrder(pat, 'Clarify', 'clarify-participant')
  await phoneOrder(fran, 'Clarify', 'clarify-facilitator')

  // The longest topic on stage: the facilitator's pitch buttons sit under the ring and Continue
  // to voting is in the toolbar, so they stay on the share; the topic stays at 44 px.
  await btn(fran, `Edit "${ai}"`).click()
  await fran.getByRole('textbox', { name: 'Edit topic' }).fill(LONG)
  await fran.getByRole('textbox', { name: 'Edit topic' }).press('Enter')
  await expect(pat.getByRole('heading', { level: 1, name: LONG })).toBeVisible()
  for (const page of [fran, pat]) await onTheShare(page, 'Clarify', 44)
  for (const name of ['Pause', 'Next pitch', 'Stop pitching', 'Continue to voting'])
    await expect(btn(fran, name)).toBeInViewport({ ratio: 1 })
  await fran.screenshot({ path: `${SHOTS}/clarify-pitching-long-facilitator-light-1280x720.png` })
  await pat.screenshot({ path: `${SHOTS}/clarify-pitching-long-participant-light-1280x720.png` })
  await btn(fran, `Edit "${LONG}"`).click()
  await fran.getByRole('textbox', { name: 'Edit topic' }).fill(ai)
  await fran.getByRole('textbox', { name: 'Edit topic' }).press('Enter')
  await expect(pat.getByRole('heading', { level: 1, name: ai })).toBeVisible()

  // Participants get none of the facilitator's controls.
  for (const name of [
    /^Pause$/,
    /^(Next pitch|Stop pitching|Start pitches|Skip pitches)$/,
    /^(Edit|Delete) "|^Undo merge$/,
    /^(Use|Using) \d dots?$/,
    /^Continue to voting$/,
  ])
    await expect(pat.getByRole('button', { name })).toHaveCount(0)
  await expect(patColumn.getByRole('button')).toHaveCount(0)

  // Edit and Delete from the column: no Delete on the card being pitched.
  await expect(btn(fran, `Delete "${ai}"`)).toHaveCount(0)
  await expect(btn(fran, `Edit "${ai}"`)).toBeVisible()
  await btn(fran, `Edit "${sayNo}"`).click()
  const box = fran.getByRole('textbox', { name: 'Edit topic' })
  await expect(box).toBeFocused()
  await box.fill('Saying no without burning trust')
  await box.press('Enter')
  await expect(patColumn).toContainText('Saying no without burning trust')
  await expect(btn(fran, 'Edit "Saying no without burning trust"')).toBeFocused()
  await btn(fran, 'Delete "Saying no without burning trust"').click()
  const confirm = fran.getByRole('dialog', { name: 'Delete this topic?' })
  await confirm.getByRole('button', { name: 'Delete topic' }).click()
  await expect(confirm).toBeHidden()
  await expect(franColumn.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(live(pat)).toHaveText('"Saying no without burning trust" was deleted.')
  await expect(patColumn.getByRole('heading', { level: 2 })).toHaveText('To discuss 4')

  // Stop pitching: the stage goes back to the note and focus to its heading.
  await btn(fran, 'Stop pitching').click()
  await expect(fran.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(live(pat)).toHaveText('Pitches stopped.')
  await btn(fran, 'Use 2 dots').click()
  await expect(btn(fran, 'Using 2 dots')).toBeDisabled()
  // aria-disabled, not disabled: the button keeps keyboard focus once the suggestion applies.
  await expect(btn(fran, 'Using 2 dots')).toBeFocused()
  await expect(franStage).toContainText('Continue to voting opens 2 dots each and a 1:30 clock.')
  await btn(fran, 'Continue to voting').click()
  await expect(
    pat.getByRole('navigation', { name: 'Session progress' }).locator('[aria-current="step"]'),
  ).toContainText('Vote')

  for (const g of guards) g.check()
})
