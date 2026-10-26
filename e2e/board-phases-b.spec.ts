import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { guard } from './guard.ts'

// Loaded as CommonJS: some of its dependencies trip Playwright's ES module loader.
const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs')

// Vote, Wrap-up and the ended board on the Discuss frame (option 3): the cards stay on the board
// and take dots in place, the agenda carries into Discuss, and the final board closes the session.
// Screenshots go to SHOTS_DIR (default test-results/screens/board-phases-b) for review.
test.setTimeout(480_000)

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/screens/board-phases-b'
const SHARE = { width: 1280, height: 720 }
const PHONE = { width: 390, height: 844 }
const SIZES = [
  [1280, 720],
  [1440, 900],
] as const
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const themeToggle = (page: Page) =>
  page.getByRole('button', { name: /Switch to (dark|light) mode/ })
/** A card in a column: the outer list item, not an action listed under it. */
const card = (page: Page, column: string, text: string) =>
  region(page, column).getByRole('listitem').filter({ hasText: text }).first()
const rpcDone = (page: Page, fn: string) =>
  page.waitForResponse((r) => r.url().includes(`/rpc/${fn}`) && r.ok())

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

/** Light and dark at the share sizes, back at 1280 x 720 in the light theme. */
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

/** Teams legibility (build prompt section 3): sizes as rendered, no sideways scroll. */
async function legibility(page: Page, focus?: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  return page.evaluate((focusText) => {
    const size = (el: Element | null | undefined) =>
      el ? parseFloat(getComputedStyle(el).fontSize) : 0
    let smallest = Infinity
    for (const el of document.querySelectorAll('main *, header *, nav *')) {
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
      if (!text || el.closest('.sr-only, dialog:not([open])')) continue
      if (el.getBoundingClientRect().width > 0) smallest = Math.min(smallest, size(el))
    }
    // The focus item on the stage; the same text is smaller on its card.
    const focus = [...document.querySelectorAll('main p, main h1')]
      .filter((el) => el.textContent === focusText)
      .map(size)
    return {
      focus: Math.max(0, ...focus),
      digits: size(document.querySelector('main [role="timer"] span')),
      smallest,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  }, focus)
}

const measured: Record<string, unknown> = {}

/** Columns from the top of the share; the stage's main button inside 720 px. */
async function onShare(page: Page, columns: string[], visible: string) {
  for (const name of columns) {
    const box = await region(page, name).boundingBox()
    expect(box?.y ?? 720).toBeLessThan(300)
  }
  await expect(btn(page, visible).or(page.getByLabel(visible, { exact: true }))).toBeInViewport({
    ratio: 1,
  })
}

/** Phones stack the stage first; the page order matches, and nothing scrolls sideways. */
async function phone(page: Page, name: string, order: string[]) {
  await page.setViewportSize(PHONE)
  expect((await legibility(page)).sideways).toBe(false)
  const tops = await Promise.all(
    order.map(async (label) => (await region(page, label).boundingBox())?.y ?? 0),
  )
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  const named = () =>
    page
      .getByRole('main')
      .getByRole('region')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  await expect.poll(named).toEqual(order)
  await page.screenshot({ path: `${SHOTS}/${name}-phone-390x844.png` })
  await page.screenshot({ path: `${SHOTS}/${name}-phone-390-full.png`, fullPage: true })
  await page.setViewportSize(SHARE)
  const wide = [order[1], order[0], ...order.slice(2)]
  await expect.poll(named).toEqual(wide)
}

test('Vote, Wrap-up and the ended board as the board', async ({ browser }) => {
  const fran = await (await browser.newContext({ viewport: SHARE })).newPage()
  const pat = await (await browser.newContext({ viewport: SHARE })).newPage()
  const guards = [guard(fran), guard(pat)]

  // Lobby: a one-dot vote breaks ties, so the tie-break round is on the board too.
  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(`E2E board phases b ${Date.now()}`)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  await fran.getByLabel('If votes tie').selectOption('mini_vote')
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  await expect(pat.getByLabel('If votes tie')).toHaveValue('mini_vote')
  const start = btn(fran, 'Start brainstorm for 2 people')
  await expect(start).toBeVisible({ timeout: 20_000 })
  await start.click()

  const [onboard, ai, pairing, async, sayNo, decisions] = [
    'How do we onboard remote hires in their first two weeks?',
    'AI tools: what is actually saving us time?',
    'Pairing vs. async code review',
    'Making async updates actually get read',
    'Saying no to stakeholders without burning trust',
    'Where should decisions get written down?',
  ] as const
  for (const [page, text] of [
    [pat, onboard],
    [pat, ai],
    [pat, pairing],
    [fran, async],
    [fran, sayNo],
    [fran, decisions],
  ] as const) {
    await page.getByLabel('New topic').fill(text)
    await page.getByLabel('New topic').press('Enter')
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  await btn(fran, 'End brainstorm now').click()
  await btn(fran, 'Skip pitches').click()

  // Vote: the cards stay in To discuss and take dots in place; the stage has the clock.
  for (const page of [fran, pat]) {
    await expect(page.getByText('Counts hidden until reveal')).toBeVisible()
    const named = page
      .getByRole('main')
      .getByRole('region')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    expect(await named).toEqual(['To discuss', 'Voting', 'Discussed'])
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Spend your 3 dots on what you most want to discuss',
    )
    await expect(region(page, 'To discuss').getByRole('heading', { level: 2 })).toHaveText(
      'To discuss 6',
    )
    await expect(region(page, 'Discussed')).toContainText('Topics move here once discussed')
  }
  // Nobody can dot their own topic: Fran votes on Pat's, Pat on Fran's.
  await expect(card(fran, 'To discuss', async)).toContainText('YOUR TOPIC')
  await expect(btn(fran, `Add a dot to "${async}"`)).toHaveCount(0)
  for (const t of [onboard, onboard, ai])
    await Promise.all([rpcDone(fran, 'cast_dots'), btn(fran, `Add a dot to "${t}"`).click()])
  await expect(fran.getByText('0 left', { exact: true })).toBeVisible()
  await expect(card(fran, 'To discuss', onboard).getByRole('img')).toHaveAccessibleName(
    '2 of your dots',
  )
  // Before the reveal Pat sees no counts, only how many have finished.
  await expect(region(pat, 'To discuss')).not.toContainText(/\d votes?/)
  await btn(fran, "I'm done").click()
  await expect(region(pat, 'Voting')).toContainText('1 of 2 finished')
  await expect(region(pat, 'Voting')).not.toContainText('Fran')

  for (const page of [fran, pat]) {
    const sizes = await legibility(page)
    measured[`vote ${page === fran ? 'facilitator' : 'participant'}`] = sizes
    expect(sizes.digits).toBeGreaterThanOrEqual(64)
    expect(sizes.smallest).toBeGreaterThanOrEqual(13)
    expect(sizes.sideways).toBe(false)
  }
  await onShare(fran, ['To discuss', 'Voting', 'Discussed'], 'Reveal results now')
  await onShare(pat, ['To discuss', 'Voting', 'Discussed'], "I'm done")
  await shoot(fran, 'vote-facilitator')
  await shoot(pat, 'vote-participant')
  // The rest of the checks outlast a 1:30 vote, so the facilitator pauses the clock.
  await btn(fran, 'Pause').click()
  await expect(region(pat, 'Voting').getByRole('timer')).toContainText('Paused')
  await axeBoth(fran, 'vote, facilitator')
  await axeBoth(pat, 'vote, participant')
  await phone(pat, 'vote-participant', ['Voting', 'To discuss', 'Discussed'])
  await phone(fran, 'vote-facilitator', ['Voting', 'To discuss', 'Discussed'])

  // The last dot and "I'm done" straight after it: the dot is still on its way when the button
  // is pressed. "I'm done" waits for it, so voting does not close first and the dot is kept.
  for (const t of [async, sayNo])
    await Promise.all([rpcDone(pat, 'cast_dots'), btn(pat, `Add a dot to "${t}"`).click()])
  const castStatus: number[] = []
  const at = { castAnswered: 0, finishSent: 0 }
  pat.on('response', (r) => {
    if (!r.url().includes('/rpc/cast_dots')) return
    castStatus.push(r.status())
    at.castAnswered = Date.now()
  })
  pat.on('request', (r) => {
    if (r.url().includes('/rpc/finish_voting')) at.finishSent = Date.now()
  })
  await pat.route('**/rest/v1/rpc/cast_dots', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await btn(pat, `Add a dot to "${decisions}"`).click()
  await btn(pat, "I'm done").click()
  await expect(pat.getByRole('heading', { level: 1, name: 'Here is the agenda' })).toBeVisible()
  await pat.unroute('**/rest/v1/rpc/cast_dots')
  // One dot request, saved: a refused one would answer 400 (voting closed).
  expect(castStatus.map((status) => status < 300)).toEqual([true])
  expect(at.finishSent).toBeGreaterThanOrEqual(at.castAnswered)
  await expect(card(pat, 'To discuss', decisions)).toContainText('1 vote')
  await expect(pat.getByRole('alert')).toHaveCount(0)

  // The reveal: To discuss is the ranked agenda with totals and ties; Discussed is still empty.
  await expect(fran.getByRole('heading', { level: 1, name: 'Here is the agenda' })).toBeVisible()
  for (const page of [fran, pat]) {
    await expect(region(page, 'Results')).toBeVisible()
    await expect(card(page, 'To discuss', onboard)).toContainText('UP NEXT')
    await expect(card(page, 'To discuss', onboard)).toContainText('2 votes')
    await expect(region(page, 'To discuss').getByText('TIED', { exact: true })).toHaveCount(4)
    await expect(card(page, 'To discuss', pairing)).not.toContainText('TIED')
    await expect(region(page, 'Results')).toContainText(`UP NEXT${onboard}`)
    await expect(region(page, 'Discussed').getByRole('heading')).toHaveText('Discussed 0')
  }
  await expect(pat.getByText('Voting closed. Here is the agenda.')).toBeAttached()
  await expect(region(pat, 'Results')).toContainText('Waiting for the facilitator')
  await expect(
    pat.getByRole('button', { name: /^(Move|Start discussing|Quick vote)/ }),
  ).toHaveCount(0)
  await expect(btn(fran, `Move "${onboard}" up`)).toHaveAttribute('aria-disabled', 'true')
  await expect(btn(fran, 'Quick vote on 4 tied at 1')).toBeVisible()
  for (const page of [fran, pat]) {
    const sizes = await legibility(page, onboard)
    measured[`results ${page === fran ? 'facilitator' : 'participant'}`] = sizes
    expect(sizes.focus).toBeGreaterThanOrEqual(44)
    expect(sizes.smallest).toBeGreaterThanOrEqual(13)
    expect(sizes.sideways).toBe(false)
  }
  await onShare(fran, ['To discuss', 'Results', 'Discussed'], 'Start discussing')
  // Downloads from the reveal on, in the toolbar as in Discuss; Escape returns focus.
  await btn(pat, 'Downloads').click()
  await expect(
    pat.getByRole('dialog', { name: 'Download the results' }).getByRole('button', {
      name: 'Download Excel file',
    }),
  ).toBeEnabled()
  await pat.keyboard.press('Escape')
  await expect(btn(pat, 'Downloads')).toBeFocused()
  await shoot(fran, 'results-facilitator')
  await shoot(pat, 'results-participant')
  await axeBoth(fran, 'results, facilitator')
  await axeBoth(pat, 'results, participant')
  await phone(pat, 'results-participant', ['Results', 'To discuss', 'Discussed'])
  await phone(fran, 'results-facilitator', ['Results', 'To discuss', 'Discussed'])

  // A one-dot vote among the tied topics, on the same cards; the pressed button has gone, so
  // focus moves to the stage heading.
  await btn(fran, 'Quick vote on 4 tied at 1').click()
  await expect(fran.getByRole('heading', { level: 1 })).toHaveText(
    'Tie-break: one dot for the topic you most want first',
  )
  await expect(fran.getByRole('heading', { level: 1 })).toBeFocused()
  await btn(fran, 'Pause').click()
  for (const page of [fran, pat]) {
    await expect(region(page, 'Voting')).toContainText('TIE-BREAK')
    await expect(card(page, 'To discuss', onboard)).toContainText('2 votes')
    await expect(card(page, 'To discuss', pairing).getByRole('button')).toHaveCount(0)
  }
  // Only the tied cards take the dot, and nobody's own topic: one for Fran, three for Pat.
  await expect(fran.getByRole('button', { name: /^Add a dot/ })).toHaveCount(1)
  await expect(pat.getByRole('button', { name: /^Add a dot/ })).toHaveCount(3)
  await Promise.all([rpcDone(fran, 'cast_dots'), btn(fran, `Add a dot to "${ai}"`).click()])
  await Promise.all([rpcDone(pat, 'cast_dots'), btn(pat, `Add a dot to "${async}"`).click()])
  await expect(pat.getByText('0 left', { exact: true })).toBeVisible()
  await pat.screenshot({ path: `${SHOTS}/tie-break-participant-light-1280x720.png` })
  await fran.screenshot({ path: `${SHOTS}/tie-break-facilitator-light-1280x720.png` })
  await axeBoth(pat, 'tie-break, participant')
  for (const page of [fran, pat]) await btn(page, "I'm done").click()

  // Still tied: AI tools and async updates. The facilitator orders them with the arrows; the
  // button keeps focus as its card moves.
  await expect(card(pat, 'To discuss', ai)).toContainText('1 vote + 1 in the tie-break')
  const moveUp = btn(fran, `Move "${async}" up`)
  await moveUp.click()
  await expect(
    region(pat, 'To discuss').getByRole('list').first().locator(':scope > li').nth(1),
  ).toContainText(async)
  await expect(moveUp).toBeFocused()
  await btn(fran, 'Start discussing').click()

  // Discuss keeps the shape: the agenda is To discuss, and Discussed fills on the right.
  await expect(region(pat, 'Discussing')).toContainText('UP NEXT')
  await expect(pat.getByRole('heading', { level: 1, name: onboard })).toBeVisible()
  await btn(fran, 'Start the 5:00 clock').click()
  await pat.getByLabel('New action').fill('Draft a two-week onboarding checklist')
  await pat.getByLabel('Action owner').fill('Maya')
  await btn(pat, 'Add action').click()
  await expect(region(fran, 'Discussing')).toContainText('Draft a two-week onboarding checklist')
  await btn(fran, 'Next topic').click()
  await expect(card(pat, 'Discussed', onboard)).toContainText('2 votes')
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(pat.getByRole('heading', { level: 1, name: async })).toBeVisible()
  await btn(fran, 'Skip').click()
  await expect(region(pat, 'To discuss').getByRole('list', { name: 'Skipped 1' })).toContainText(
    async,
  )

  // A re-vote: the board keeps Discussed and Skipped with the dots that ranked them.
  await btn(fran, 'Re-vote remaining topics').click()
  await expect(region(pat, 'Voting')).toContainText('RE-VOTE')
  await btn(fran, 'Pause').click()
  await expect(card(pat, 'Discussed', onboard)).toContainText('2 votes')
  await expect(region(pat, 'To discuss').getByRole('list', { name: 'Skipped 1' })).toContainText(
    `${async}Fran · 1 vote`,
  )
  await expect(pat.getByText('4 topics on the ballot')).toBeVisible()
  await pat.screenshot({ path: `${SHOTS}/re-vote-participant-light-1280x720.png` })
  await Promise.all([rpcDone(fran, 'cast_dots'), btn(fran, `Add a dot to "${pairing}"`).click()])
  for (const page of [fran, pat]) await btn(page, "I'm done").click()
  await expect(card(pat, 'To discuss', pairing)).toContainText('UP NEXT')
  await btn(fran, 'Start discussing').click()
  await btn(fran, 'Start the 5:00 clock').click()
  await expect(pat.getByRole('heading', { level: 1, name: pairing })).toBeVisible()
  await btn(fran, 'Next topic').click()
  await btn(fran, 'Start wrap-up').first().click()

  // Wrap-up: the final board. Not discussed on the left, the stage, Discussed on the right.
  for (const page of [fran, pat]) {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Nice work. Capture what you are taking away.' }),
    ).toBeVisible()
    const named = await page
      .getByRole('main')
      .getByRole('region')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    expect(named).toEqual(['Not discussed', 'Wrap-up', 'Discussed'])
    await expect(card(page, 'Not discussed', async)).toContainText('Fran · 1 vote · skipped')
    await expect(card(page, 'Discussed', onboard)).toContainText(
      'Draft a two-week onboarding checklist · Maya',
    )
    await expect(btn(page, 'Download Word file')).toBeEnabled()
    await expect(page.getByText('2 of 6 discussed')).toBeVisible()
  }
  await expect(btn(pat, 'End session')).toHaveCount(0)
  await expect(btn(pat, 'Pause')).toHaveCount(0)
  await expect(region(fran, 'Wrap-up').getByRole('button', { name: 'Add 1 minute' })).toBeVisible()
  await pat.getByLabel('Your take-away').fill('A checklist beats a buddy system for week one.')
  await btn(pat, 'Share').click()
  await btn(fran, 'Pass').click()
  await expect(region(fran, 'Wrap-up')).toContainText(
    'Pat A checklist beats a buddy system for week one.',
  )
  await expect(region(pat, 'Wrap-up')).toContainText('Fran Passed.')
  await expect(region(pat, 'Wrap-up')).toContainText('1 of 2 shared')
  await pat.getByLabel('New action').fill('Book the next Lean Coffee')
  await pat.getByLabel('Action owner').fill('Leo')
  await btn(pat, 'Add action').click()
  const others = region(fran, 'Discussed').getByRole('list', { name: 'Other actions 1' })
  await expect(others).toContainText('Book the next Lean Coffee · Leo')
  // The box follows the server, so it ticks once the change is saved, for everyone.
  const checklist = (page: Page) =>
    page.getByRole('checkbox', { name: 'Done: Draft a two-week onboarding checklist' })
  await checklist(pat).click()
  for (const page of [pat, fran]) await expect(checklist(page)).toBeChecked()
  for (const page of [fran, pat]) {
    const sizes = await legibility(page)
    measured[`wrap-up ${page === fran ? 'facilitator' : 'participant'}`] = sizes
    expect(sizes.digits).toBeGreaterThanOrEqual(64)
    expect(sizes.smallest).toBeGreaterThanOrEqual(13)
    expect(sizes.sideways).toBe(false)
    await onShare(page, ['Not discussed', 'Wrap-up', 'Discussed'], 'Your take-away')
  }

  // The files use the board's dots: after the re-vote the discussed topic keeps its 2.
  const [xlsx] = await Promise.all([
    pat.waitForEvent('download'),
    btn(pat, 'Download Excel file').click(),
  ])
  expect(xlsx.suggestedFilename()).toMatch(/^E2E board phases b \d+ \d{4}-\d{2}-\d{2}\.xlsx$/)
  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile((await xlsx.path()) ?? '')
  const rows: unknown[][] = []
  book.getWorksheet('Topics')?.eachRow((row) => rows.push(row.values as unknown[]))
  expect(rows.find((r) => r[2] === onboard)?.slice(4, 6)).toEqual([2, 'Discussed'])
  expect(rows.find((r) => r[2] === async)?.slice(4, 6)).toEqual([1, 'Skipped'])
  await shoot(fran, 'wrap-up-facilitator')
  await shoot(pat, 'wrap-up-participant')
  await axeBoth(fran, 'wrap-up, facilitator')
  await axeBoth(pat, 'wrap-up, participant')
  await phone(fran, 'wrap-up-facilitator', ['Wrap-up', 'Not discussed', 'Discussed'])
  await phone(pat, 'wrap-up-participant', ['Wrap-up', 'Not discussed', 'Discussed'])

  // End session: the same board, read-only, with the downloads (spec F25, D61).
  await btn(fran, 'End session').click()
  await expect(
    fran.getByRole('heading', { level: 1, name: 'This session has ended' }),
  ).toBeFocused()
  for (const page of [fran, pat]) {
    await expect(
      page.getByRole('heading', { level: 1, name: 'This session has ended' }),
    ).toBeVisible()
    await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0)
    const boxes = page.getByRole('main').getByRole('checkbox')
    await expect(boxes).toHaveCount(2)
    for (const box of await boxes.all()) await expect(box).toBeDisabled()
    await expect(btn(page, 'Download Word file')).toBeEnabled()
    await expect(page.getByRole('button', { name: /^(Edit|Delete) "/ })).toHaveCount(0)
    await expect(region(page, 'Session ended')).toContainText('Fran Passed.')
    const sizes = await legibility(page)
    measured[`ended ${page === fran ? 'facilitator' : 'participant'}`] = sizes
    expect(sizes.smallest).toBeGreaterThanOrEqual(13)
    expect(sizes.sideways).toBe(false)
  }
  const [docx] = await Promise.all([
    pat.waitForEvent('download'),
    btn(pat, 'Download Word file').click(),
  ])
  expect(docx.suggestedFilename()).toMatch(/\.docx$/)
  // Access controls still work after the end.
  await btn(fran, '2 people').click()
  await expect(btn(fran, 'Manage people')).toBeVisible()
  await fran.keyboard.press('Escape')
  await shoot(fran, 'ended-facilitator')
  await shoot(pat, 'ended-participant')
  await axeBoth(fran, 'ended, facilitator')
  await axeBoth(pat, 'ended, participant')
  await phone(pat, 'ended-participant', ['Session ended', 'Not discussed', 'Discussed'])
  await phone(fran, 'ended-facilitator', ['Session ended', 'Not discussed', 'Discussed'])

  console.log(JSON.stringify(measured, null, 1))
  for (const g of guards) g.check()
})
