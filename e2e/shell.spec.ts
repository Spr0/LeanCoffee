import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { guard } from './guard.ts'

// The frame every phase shares: the header at every width, the toolbar dialogs (focus, removing
// someone, what they repeat from the page behind them), the downloads, the error and reconnecting
// notices, forced colors, a board that does not load, and the facilitator's dialogs after the role
// moves. One board.
test.setTimeout(300_000)

const SHARE = { width: 1280, height: 720 }
// The longest session name the server allows (60 characters).
const NAME = `E2E shell ${Date.now()} header with a long session name to cut`.slice(0, 60)
const btn = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' })
const BOARD_STATE = /\/rest\/v1\/board_state\?/

/** Where the header's parts sit, and whether anything spills out of it or off the page. */
async function headerFit(page: Page) {
  return page.locator('header').evaluate((header) => {
    const box = header.getBoundingClientRect()
    const spill: string[] = []
    for (const el of header.querySelectorAll<HTMLElement>('a, button, span')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || el.closest('.sr-only')) continue
      if (r.top < box.top || r.bottom > box.bottom || r.left < 0 || r.right > window.innerWidth)
        spill.push(`${el.textContent?.trim() || el.getAttribute('aria-label')} ${r.left},${r.top}`)
    }
    const code = [...header.querySelectorAll('span')].find((s) =>
      /^Room code:/.test(s.textContent ?? ''),
    )
    const name = header.querySelector<HTMLElement>('.truncate')
    return {
      height: box.height,
      spill,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
      codeLines: code ? Math.round(code.getBoundingClientRect().height / 20) : 0,
      nameWidth: name && name.offsetWidth > 0 ? name.offsetWidth : 0,
      nameCut: name ? name.scrollWidth > name.clientWidth : false,
    }
  })
}

test('the frame every phase shares', async ({ browser }) => {
  const fran = await (await browser.newContext({ viewport: SHARE })).newPage()
  const pat = await (await browser.newContext({ viewport: SHARE })).newPage()
  const guards = [guard(fran), guard(pat)]

  await fran.goto('/')
  await fran.getByLabel('Name', { exact: true }).fill('Fran')
  await fran.getByLabel('Name this session').fill(NAME)
  await btn(fran, 'Create board').click()
  await expect(fran.getByTestId('room-code')).toBeVisible({ timeout: 15_000 })
  await pat.goto(fran.url())
  await pat.getByLabel('Name', { exact: true }).fill('Pat')
  await btn(pat, 'Join session').click()
  await expect(pat.getByText(/Waiting for Fran/)).toBeVisible({ timeout: 15_000 })

  // A phase change takes the pressed button with it; focus goes to the new page heading.
  const start = btn(fran, 'Start brainstorm for 2 people')
  await expect(start).toBeVisible({ timeout: 20_000 })
  await start.focus()
  await fran.keyboard.press('Enter')
  await expect(fran.locator('main h1')).toBeFocused({ timeout: 15_000 })

  for (const [page, text] of [
    [pat, 'Pairing vs. async code review'],
    [fran, 'Where should decisions get written down?'],
  ] as const) {
    await page.getByLabel('New topic').fill(text)
    await page.getByLabel('New topic').press('Enter')
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  }
  const end = btn(fran, 'End brainstorm now')
  await end.focus()
  await fran.keyboard.press('Enter')
  await expect(fran.locator('main h1')).toBeFocused({ timeout: 15_000 })
  await btn(fran, 'Skip pitches').click()
  for (const page of [fran, pat]) await btn(page, "I'm done").click()
  await expect(pat.getByRole('heading', { name: 'Here is the agenda' })).toBeVisible({
    timeout: 15_000,
  })
  await btn(fran, 'Start discussing').click()
  await expect(btn(fran, /^Start the .* clock$/)).toBeVisible({ timeout: 15_000 })

  // The header: one 64 px line at every width, the room code on one line, the name cut short.
  const widths = [320, 360, 390, 640, 768, 853, 1024, 1280, 1440]
  for (const page of [fran, pat]) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 640 ? 800 : 720 })
      const fit = await headerFit(page)
      await page.screenshot({
        path: `test-results/screens/shell/header-${page === fran ? 'facilitator' : 'participant'}-${width}.png`,
        clip: { x: 0, y: 0, width, height: 64 },
      })
      expect(fit, `${width} px`).toMatchObject({
        height: 64,
        spill: [],
        sideways: false,
        codeLines: 1,
      })
      if (width >= 768) expect(fit.nameWidth, `${width} px`).toBeGreaterThan(0)
      if (width >= 1280) expect(fit.nameWidth).toBeLessThanOrEqual(320)
      if (width >= 1280) expect(fit.nameCut).toBe(true)
    }
    await page.setViewportSize(SHARE)
  }
  const home = await fran.getByRole('link', { name: 'Lean Coffee home' }).boundingBox()
  expect(home?.height).toBeGreaterThanOrEqual(44)

  // The people dialog opens on its title, at the top, by keyboard.
  await btn(fran, '2 people').focus()
  await fran.keyboard.press('Enter')
  const people = fran.getByRole('dialog', { name: 'People' })
  await expect(people.getByRole('heading', { name: 'People' })).toBeFocused()
  expect(await people.evaluate((d) => d.scrollTop)).toBe(0)
  await expect(people.getByRole('list', { name: 'People connected' })).toHaveText(/Fran.*Pat/)
  await btn(fran, 'Manage people').focus()
  await fran.keyboard.press('Enter')
  const manage = fran.getByRole('dialog', { name: 'People on this board' })
  await expect(manage.getByRole('heading', { name: 'People on this board' })).toBeFocused()
  // A second Enter presses nothing; Remove names who it removes, and asks first.
  await fran.keyboard.press('Enter')
  await expect(manage.getByRole('group')).toHaveCount(0)
  await manage.getByRole('button', { name: 'Remove Pat' }).focus()
  await fran.keyboard.press('Enter')
  await expect(manage.getByRole('group', { name: 'Remove Pat?' })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark')
      await fran.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
    await fran.screenshot({
      path: `test-results/screens/shell/remove-confirm-${theme}-1280x720.png`,
    })
  }
  await fran.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await expect(manage.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await fran.keyboard.press('Enter')
  await expect(manage.getByRole('button', { name: 'Remove Pat' })).toBeFocused()
  await expect(manage.getByText('You', { exact: true })).toBeVisible()
  // The switches are 44 px targets and keep their state readable in forced colors.
  const lock = manage.getByRole('switch', { name: 'Lock the board' })
  expect((await lock.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await fran.emulateMedia({ forcedColors: 'active' })
  const knob = await lock.evaluate((el) =>
    [el.querySelector('span'), el.querySelector('span span')].map(
      (s) => s && getComputedStyle(s).backgroundColor,
    ),
  )
  expect(knob[0]).not.toBe(knob[1])
  await fran.emulateMedia({ forcedColors: 'none' })
  expect((await new AxeBuilder({ page: fran }).analyze()).violations).toEqual([])
  await fran.keyboard.press('Escape')
  await fran.keyboard.press('Escape')
  await expect(fran.getByRole('dialog')).toHaveCount(0)

  // A toolbar dialog makes the page inert, so it repeats what the board says after it opened.
  await btn(pat, '2 people').click()
  const patPeople = pat.getByRole('dialog', { name: 'People' })
  await expect(patPeople.getByRole('status')).toHaveText('')
  await btn(fran, /^Start the .* clock$/).click()
  await expect(patPeople.getByRole('status')).not.toHaveText('')
  await btn(pat, 'Done').click()

  // Forced colors: filled buttons keep an edge; the ring keeps system colors, remaining time
  // the strong arc.
  await fran.emulateMedia({ forcedColors: 'active' })
  const next = btn(fran, 'Next topic')
  await expect(next).toHaveCSS('border-top-width', '2px')
  const ring = await fran.getByRole('timer').evaluate((el) => {
    const [track, arc] = [...el.querySelectorAll('circle')].map((c) => getComputedStyle(c).stroke)
    return { track, arc }
  })
  expect(ring.arc).not.toBe(ring.track)
  await fran.screenshot({ path: 'test-results/screens/shell/forced-colors-1280x720.png' })
  await fran.emulateMedia({ forcedColors: 'none' })

  // An error floats over the stepper instead of pushing the board down, with a 44 px Dismiss.
  const stage = fran.getByRole('region', { name: /Discussing|Up next/ })
  const before = (await stage.boundingBox())?.y
  await fran.route(/\/rpc\/timer_pause/, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'P0001', message: 'not_allowed' }),
    }),
  )
  await btn(fran, 'Pause').click()
  const alert = fran.getByRole('alert')
  await expect(alert).toBeVisible()
  expect(await alert.locator('..').evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
  expect((await stage.boundingBox())?.y).toBe(before)
  expect((await btn(fran, 'Dismiss').boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await fran.screenshot({ path: 'test-results/screens/shell/error-1280x720.png' })
  await btn(fran, 'Dismiss').click()
  await expect(alert).toHaveCount(0)
  await fran.unroute(/\/rpc\/timer_pause/)

  // Downloads: the pressed button keeps focus while the file is built, and says when it is ready.
  await btn(pat, 'Downloads').click()
  const downloads = pat.getByRole('dialog', { name: 'Download the results' })
  await expect(downloads.getByRole('heading', { name: 'Download the results' })).toBeFocused()
  const word = downloads.getByRole('button', { name: 'Download Word file' })
  await word.focus()
  const [file] = await Promise.all([pat.waitForEvent('download'), pat.keyboard.press('Enter')])
  expect(file.suggestedFilename()).toMatch(/\.docx$/)
  await expect(downloads.getByRole('status').first()).toHaveText('Word file downloaded.')
  await expect(word).toBeFocused()
  await btn(pat, 'Done').click()

  // The facilitator's dialogs close for good when the role moves away (security).
  await btn(fran, '2 people').click()
  await btn(fran, 'Pass facilitator role').click()
  await fran.getByRole('radio', { name: 'Pat' }).check()
  await btn(fran, 'Pass to Pat').click()
  await btn(fran, 'Done').click()
  await expect(pat.getByText('FACILITATOR', { exact: true })).toBeVisible({ timeout: 15_000 })
  await btn(pat, '2 people').click()
  await btn(pat, 'Manage people').click()
  await expect(pat.getByRole('dialog', { name: 'People on this board' })).toBeVisible()
  await btn(fran, '2 people').click()
  await btn(fran, 'Take the facilitator role back').click()
  await expect(pat.getByRole('dialog', { name: 'People on this board' })).toHaveCount(0, {
    timeout: 15_000,
  })
  await expect(pat.getByRole('dialog', { name: 'People' })).toBeVisible()
  await expect(pat.getByRole('switch')).toHaveCount(0)
  expect(await pat.locator('button[aria-label^="Remove "]').count()).toBe(0)
  await btn(pat, 'Done').click()
  await btn(fran, 'Done').click()

  // A board that does not load reopens on its own once, then says so with Try again.
  await pat.route(BOARD_STATE, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
      : route.continue(),
  )
  await pat.reload()
  await expect(pat.getByText('Loading the board…')).toBeVisible()
  await expect(pat.getByRole('alert')).toContainText('The board is not loading', {
    timeout: 30_000,
  })
  await pat.screenshot({ path: 'test-results/screens/shell/not-loading-1280x720.png' })
  await pat.unroute(BOARD_STATE)
  await btn(pat, 'Try again').click()
  await expect(btn(pat, '2 people')).toBeVisible({ timeout: 15_000 })

  // One failed read: it reopens on its own and loads, with no Try again.
  let failures = 2
  await pat.route(BOARD_STATE, (route) =>
    route.request().method() === 'GET' && failures-- > 0
      ? route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
      : route.continue(),
  )
  await pat.reload()
  await expect(btn(pat, '2 people')).toBeVisible({ timeout: 20_000 })
  await expect(pat.getByRole('alert')).toHaveCount(0)
  await pat.unroute(BOARD_STATE)

  // Removing someone: confirmed, and focus waits at the top of the list.
  await btn(fran, '2 people').click()
  await btn(fran, 'Manage people').click()
  const list = fran.getByRole('dialog', { name: 'People on this board' })
  await list.getByRole('button', { name: 'Remove Pat' }).click()
  await list.getByRole('button', { name: 'Remove Pat' }).click()
  await expect(list.getByRole('heading', { name: 'People on this board' })).toBeFocused()
  await expect(pat.getByRole('heading', { name: 'You are no longer on this board' })).toBeVisible({
    timeout: 25_000,
  })
  await expect(list.getByRole('listitem')).toHaveCount(1)

  for (const g of guards) g.check()
})
