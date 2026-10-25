import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// Gate 3: one facilitator and five participants run a full six-phase session with nine topics,
// two extensions and a handover, while we check that hidden values never reach participants.
test.setTimeout(240_000)

const NAMES = ['Fran', 'Pat', 'Quinn', 'Ravi', 'Sam', 'Tess']
const TOPICS: Record<string, string[]> = {
  Fran: ['Release notes nobody reads'],
  Pat: ['Onboarding remote hires', 'Code review turnaround'],
  Quinn: ['AI tools that actually save time', 'Flaky end-to-end tests'],
  Ravi: ['Saying no to stakeholders', 'Retro cadence'],
  Sam: ['Where decisions get written down'],
  Tess: ['Scope creep on fixed-price work'],
}

const at = (pages: Record<string, Page>, name: string): Page => {
  const page = pages[name]
  if (!page) throw new Error(`no page for ${name}`)
  return page
}

const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

test('six people run a whole session', async ({ browser }) => {
  const pages: Record<string, Page> = {}
  const guards: ReturnType<typeof guard>[] = []
  for (const name of NAMES) {
    const page = await (await browser.newContext()).newPage()
    guards.push(guard(page))
    pages[name] = page
  }
  const fran = at(pages, 'Fran')
  const others = NAMES.slice(1).map((n) => at(pages, n))
  const pat = at(pages, 'Pat')

  // Watch everything Pat's browser receives, to prove hidden values never arrive early.
  const patSaw: string[] = []
  pat.on('response', async (r) => {
    if (r.url().includes('/rest/v1/')) patSaw.push(await r.text().catch(() => ''))
  })
  pat.on('websocket', (ws) => ws.on('framereceived', (f) => patSaw.push(String(f.payload))))

  // Lobby
  await fran.goto('/')
  await fran.getByLabel('Your name').fill('Fran')
  await fran.getByLabel('Board name').fill(`E2E full session ${Date.now()}`)
  await fran.getByRole('button', { name: 'Create board' }).click()
  await expect(fran.getByTestId('room-code')).toBeVisible()
  const link = fran.url()
  for (const [i, page] of others.entries()) {
    await page.goto(link)
    await page.getByLabel('Your name').fill(NAMES[i + 1] ?? '')
    await page.getByRole('button', { name: 'Join session' }).click()
    await expect(page.getByText(/Waiting for Fran/)).toBeVisible()
  }
  await expect(fran.getByRole('button', { name: 'Start brainstorm for 6 people' })).toBeVisible()
  await fran.getByRole('button', { name: 'Start brainstorm for 6 people' }).click()

  // Brainstorm: everyone writes privately.
  for (const name of NAMES) {
    const page = at(pages, name)
    await expect(
      page.getByRole('heading', { name: 'Write the topics you want to talk about' }),
    ).toBeVisible()
    for (const t of TOPICS[name] ?? []) {
      await page.getByLabel('New topic').fill(t)
      await page.getByLabel('New topic').press('Enter')
      await expect(page.getByText(t, { exact: true })).toBeVisible()
    }
  }
  await expect(fran.getByText('9 topics so far')).toBeVisible()
  await expect(pat.getByText('Flaky end-to-end tests')).toHaveCount(0)
  expect(patSaw.join('\n')).not.toContain('Flaky end-to-end tests')
  await axe(pat)
  await fran.getByRole('button', { name: 'End brainstorm now' }).click()

  // Clarify: all topics appear; merge two and undo; pitch one.
  await expect(pat.getByText('Flaky end-to-end tests')).toBeVisible()
  await fran.getByRole('button', { name: /Code review turnaround/ }).click()
  await fran.getByRole('button', { name: /Flaky end-to-end tests/ }).click()
  await fran.getByRole('button', { name: 'Merge 2 selected' }).click()
  await expect(pat.getByText('+ Flaky end-to-end tests')).toBeVisible()
  await fran.getByRole('button', { name: 'Undo merge' }).click()
  await expect(pat.getByText('+ Flaky end-to-end tests')).toHaveCount(0)
  await fran.getByRole('button', { name: 'Start pitches' }).click()
  await expect(pat.getByText('PITCHING NOW')).toBeVisible()
  await axe(fran)
  await fran.getByRole('button', { name: 'Continue to voting' }).click()

  // Vote: three dots each, counts hidden until everyone is done.
  const plan: Record<string, string[]> = {
    Fran: [
      'Onboarding remote hires',
      'Onboarding remote hires',
      'AI tools that actually save time',
    ],
    Pat: [
      'AI tools that actually save time',
      'AI tools that actually save time',
      'Saying no to stakeholders',
    ],
    Quinn: ['Onboarding remote hires', 'Saying no to stakeholders', 'Retro cadence'],
    Ravi: ['Onboarding remote hires', 'Release notes nobody reads', 'Code review turnaround'],
    Sam: [
      'AI tools that actually save time',
      'Scope creep on fixed-price work',
      'Flaky end-to-end tests',
    ],
    Tess: [
      'Onboarding remote hires',
      'Where decisions get written down',
      'Saying no to stakeholders',
    ],
  }
  const before = patSaw.length
  for (const name of NAMES) {
    const page = at(pages, name)
    await expect(page.getByText('Counts hidden until reveal')).toBeVisible()
    for (const t of plan[name] ?? [])
      await page.getByRole('button', { name: `Add a dot to "${t}"` }).click()
    await expect(page.getByText('0 left', { exact: true })).toBeVisible()
    if (name !== 'Tess') await page.getByRole('button', { name: "I'm done" }).click()
  }
  // Before the last person finishes, Pat has received only Pat's own vote rows.
  const voteRows = patSaw
    .slice(before)
    .flatMap((t) => {
      try {
        const rows = JSON.parse(t)
        return Array.isArray(rows) ? rows : []
      } catch {
        return []
      }
    })
    .filter((r: { dots?: number; user_id?: string } | null) => typeof r?.dots === 'number')
  expect(new Set(voteRows.map((r: { user_id: string }) => r.user_id)).size).toBeLessThanOrEqual(1)
  await expect(pat.getByRole('heading', { name: 'Here is the agenda' })).toHaveCount(0)
  await at(pages, 'Tess').getByRole('button', { name: "I'm done" }).click()
  await expect(pat.getByRole('heading', { name: 'Here is the agenda' })).toBeVisible()
  await expect(
    pat.getByRole('listitem').filter({ hasText: 'Onboarding remote hires' }),
  ).toContainText('5')
  await fran.getByRole('button', { name: 'Start discussing' }).click()

  // Discuss: first topic, two extensions by vote, actions.
  await fran.getByRole('button', { name: /Start the .* clock/ }).click()
  await expect(
    pat.getByRole('heading', { level: 1, name: 'Onboarding remote hires' }),
  ).toBeVisible()
  await axe(pat)
  for (let extension = 1; extension <= 2; extension++) {
    await fran.getByRole('button', { name: 'Call vote now' }).click()
    for (const [i, name] of NAMES.entries()) {
      await at(pages, name)
        .getByRole('button', { name: i < 4 ? 'Keep going' : 'Move on' })
        .click()
    }
    await expect(pat.getByText(/The group chose to keep going/)).toBeVisible()
    await expect(pat.getByText(`Extended ×${extension}`)).toBeVisible()
  }
  await pat.getByLabel('New action').fill('Draft a two-week onboarding checklist')
  await pat.getByLabel('Action owner').selectOption({ label: 'Owner: Pat' })
  await pat.getByRole('button', { name: 'Add action' }).click()
  await expect(fran.getByText('Draft a two-week onboarding checklist')).toBeVisible()

  // Handover mid-session, then the creator takes the role back.
  await fran.getByRole('button', { name: 'Pass facilitator role' }).click()
  await fran.getByRole('radio', { name: 'Quinn' }).check()
  await fran.getByRole('button', { name: 'Pass to Quinn' }).click()
  const quinn = at(pages, 'Quinn')
  await expect(quinn.getByText('FACILITATOR', { exact: true })).toBeVisible()
  await expect(fran.getByText('FACILITATOR', { exact: true })).toHaveCount(0)
  await quinn.getByRole('button', { name: 'Next topic', exact: true }).click()
  await quinn.getByRole('button', { name: /Start the .* clock/ }).click()
  await expect(pat.getByText('DISCUSSING NOW')).toBeVisible()
  await expect(
    pat.getByRole('heading', { level: 1, name: 'AI tools that actually save time' }),
  ).toBeVisible()
  await fran.getByRole('button', { name: 'Take the facilitator role back' }).click()
  await expect(fran.getByText('FACILITATOR', { exact: true })).toBeVisible()
  await fran.getByRole('button', { name: 'Stage' }).click()
  await fran.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(fran.getByRole('region', { name: 'Discussed' })).toContainText(
    'Onboarding remote hires',
  )
  await fran.getByRole('button', { name: 'Stage' }).click()
  await fran.getByRole('button', { name: 'Next topic', exact: true }).click()
  await fran.getByRole('button', { name: 'Start wrap-up' }).first().click()

  // Wrap-up: take-aways, one pass, then end.
  await expect(pat.getByRole('heading', { name: /Capture what you are taking away/ })).toBeVisible()
  await pat.getByLabel('Your take-away').fill('Buddy system first, docs second.')
  await pat.getByRole('button', { name: 'Share' }).click()
  await at(pages, 'Sam').getByRole('button', { name: 'Pass' }).click()
  await expect(fran.getByText('Buddy system first, docs second.')).toBeVisible()
  await expect(fran.getByText('Passed.')).toBeVisible()
  await expect(fran.getByText('2 of 9')).toBeVisible()
  await axe(fran)
  for (const [label, ext] of [
    ['Download Word file', 'docx'],
    ['Download Excel file', 'xlsx'],
  ] as const) {
    const [file] = await Promise.all([
      pat.waitForEvent('download'),
      pat.getByRole('button', { name: label }).click(),
    ])
    expect(file.suggestedFilename()).toMatch(
      new RegExp(`^E2E full session \\d+ \\d{4}-\\d{2}-\\d{2}\\.${ext}$`),
    )
    expect((await file.path()) ?? '').not.toBe('')
  }
  await fran.getByRole('button', { name: 'End session' }).click()
  // Downloads stay available after the session ends.
  await expect(pat.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
  await expect(pat.getByRole('heading', { name: 'This session has ended' })).toBeVisible()
  for (const g of guards) g.check()
})
