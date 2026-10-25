// Lighthouse accessibility score for every session screen (prompt Gate 5: 95 or higher).
// Drives a facilitator (in a Chrome with remote debugging, which Lighthouse audits) and a
// participant through a session, auditing the facilitator's page at each step in light and dark.
// Usage: node scripts/lighthouse-a11y.mjs <base-url> <path-to-lighthouse-package>
import { chromium } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const [base = 'http://127.0.0.1:4173', lhDir] = process.argv.slice(2)
const lighthouse = (await import(createRequire(join(resolve(lhDir), 'x')).resolve('lighthouse')))
  .default
const PORT = 9333
const fac = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lh-')), {
  args: [`--remote-debugging-port=${PORT}`],
  viewport: { width: 1440, height: 900 },
})
const pBrowser = await chromium.launch()
const pat = await (await pBrowser.newContext()).newPage()
const page = fac.pages()[0] ?? (await fac.newPage())
const results = []

async function audit(name) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('lean-coffee-theme', t), theme)
    const r = await lighthouse(page.url(), {
      port: PORT,
      onlyCategories: ['accessibility'],
      disableStorageReset: true,
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false,
      },
      logLevel: 'error',
    })
    const score = Math.round((r.lhr.categories.accessibility.score ?? 0) * 100)
    const failing = Object.values(r.lhr.audits)
      .filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary')
      .map((a) => a.id)
    results.push({ screen: name, theme, score, failing })
    console.log(
      `${name.padEnd(14)} ${theme.padEnd(5)} ${score}${failing.length ? '  failing: ' + failing.join(', ') : ''}`,
    )
  }
  await page.evaluate(() => localStorage.setItem('lean-coffee-theme', 'light'))
  await page.reload()
}

const click = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' }).click()
await page.goto(base)
await audit('home')
await page.getByLabel('Your name').fill('Priya')
await page.getByLabel('Board name').fill(`E2E lighthouse ${Date.now()}`)
await click(page, 'Create board')
await page.getByTestId('room-code').waitFor()
await pat.goto(page.url())
await audit('lobby (alone)')
await pat.getByLabel('Your name').fill('Maya')
await click(pat, 'Join session')
await page.getByRole('list', { name: 'People here now' }).getByText('Maya').waitFor()
await audit('lobby')
await click(page, /Start brainstorm/)
await page.getByLabel('New topic').fill('Making async updates actually get read')
await page.getByLabel('New topic').press('Enter')
await pat.getByLabel('New topic').fill('How do we onboard remote hires?')
await pat.getByLabel('New topic').press('Enter')
await page.getByText('Making async updates actually get read', { exact: true }).waitFor()
await audit('brainstorm')
await click(page, 'End brainstorm now')
await click(page, 'Start pitches')
await audit('clarify')
await click(page, 'Continue to voting')
await page.getByRole('button', { name: 'Add a dot to "How do we onboard remote hires?"' }).click()
await audit('vote')
await click(page, 'Reveal results now')
await audit('vote results')
await click(page, 'Start discussing')
await click(page, /Start the .* clock/)
await audit('discuss stage')
await click(page, 'Call vote now')
await audit('extend vote')
await click(page, 'Next topic')
await click(page, 'Start wrap-up')
await audit('wrap-up')
await click(page, 'End session')
await audit('ended')

await fac.close()
await pBrowser.close()
const low = results.filter((r) => r.score < 95)
console.log(
  low.length
    ? `FAIL: ${low.length} screen(s) below 95`
    : `PASS: all ${results.length} audits at 95 or higher`,
)
process.exit(low.length ? 1 : 0)
