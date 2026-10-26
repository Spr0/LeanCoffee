import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { guard } from './guard.ts'

const url = process.env.VITE_SUPABASE_URL ?? ''
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

test.describe('response headers (prompt 4.8)', () => {
  test('every page carries the security headers', async ({ request }) => {
    for (const path of ['/', '/b/ZZZZ-ZZZZ']) {
      const res = await request.get(path)
      const h = res.headers()
      const directives = Object.fromEntries(
        (h['content-security-policy'] ?? '')
          .split(';')
          .map((d) => d.trim().split(/\s+/))
          .filter((d) => d[0])
          .map(([name, ...values]) => [name, [...values].sort()]),
      )
      const supabase = new URL(url).origin
      expect(directives).toEqual({
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'", supabase, supabase.replace(/^http/, 'ws')].sort(),
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      })
      // Netlify replaces HSTS on *.netlify.app with its own one-year preload value (decision D58).
      const hsts = h['strict-transport-security'] ?? ''
      expect(hsts).toContain('includeSubDomains')
      expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31_536_000)
      expect(h['x-content-type-options']).toBe('nosniff')
      expect(h['referrer-policy']).toBe('no-referrer')
      expect(h['permissions-policy']).toContain('camera=()')
      expect(h['permissions-policy']).toContain('microphone=()')
      expect(h['permissions-policy']).toContain('geolocation=()')
      expect(h['cross-origin-opener-policy']).toBe('same-origin')
    }
    expect((await request.get('/b/ZZZZ-ZZZZ')).headers()['x-robots-tag']).toBe('noindex')
    // Crawlers must be able to fetch /b/ pages to see the noindex header (decision D53).
    expect(await (await request.get('/robots.txt')).text()).not.toContain('Disallow: /b/')
  })

  test('a missing build file is a real 404 on Netlify', async ({ request }) => {
    // The preview server falls back to index.html; only the Netlify redirect rule returns 404.
    test.skip(!(process.env.E2E_BASE_URL ?? '').includes('netlify.app'), 'Netlify only')
    const res = await request.get('/assets/does-not-exist.js')
    expect(res.status()).toBe(404)
    // Netlify applies header rules by path, so a long cache would stick to this 404 too (D71).
    expect(res.headers()['cache-control'] ?? '').not.toContain('immutable')
  })
})

const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)
// Names are limited to 24 characters, so they get a shorter payload.
const NAME_PAYLOAD = '"><img src=x>'
const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '"><script>alert(2)</script>',
  `${RLO}gnp.exe`,
  `zero${ZWSP}width`,
]

test('script-like input is shown as text everywhere and never runs', async ({ browser }) => {
  test.setTimeout(120_000)
  const fac = await (await browser.newContext()).newPage()
  const pat = await (await browser.newContext()).newPage()
  const g1 = guard(fac)
  const g2 = guard(pat)
  await fac.goto('/')
  await fac.getByLabel('Name', { exact: true }).fill('<b>Fran</b>')
  await fac.getByLabel('Name this session').fill(PAYLOADS[1] ?? '')
  await fac.getByRole('button', { name: 'Create board' }).click()
  await expect(fac.getByRole('heading', { level: 1 })).toHaveText(PAYLOADS[1] ?? '')
  await pat.goto(fac.url())
  await pat.getByLabel('Name', { exact: true }).fill(NAME_PAYLOAD)
  await pat.getByRole('button', { name: 'Join session' }).click()
  await expect(fac.getByRole('list', { name: 'People here now' })).toContainText(NAME_PAYLOAD)
  await fac.getByRole('button', { name: /Start brainstorm/ }).click()
  for (const p of PAYLOADS) {
    await pat.getByLabel('New topic').fill(p)
    await pat.getByLabel('New topic').press('Enter')
  }
  await expect(pat.getByRole('region', { name: 'To discuss' }).getByText('YOURS')).toHaveCount(4)
  // Bidi overrides and zero-width characters are stripped on the server.
  await expect(pat.getByText('gnp.exe', { exact: true })).toBeVisible()
  await expect(pat.getByText('zerowidth', { exact: true })).toBeVisible()
  await fac.getByRole('button', { name: 'End brainstorm now' }).click()
  await fac.getByRole('button', { name: 'Continue to voting' }).click()
  await fac.getByRole('button', { name: 'Reveal results now' }).click()
  await fac.getByRole('button', { name: 'Start discussing' }).click()
  await fac.getByRole('button', { name: /Start the .* clock/ }).click()
  await fac.getByLabel('New action').fill('=HYPERLINK("http://example.com","x")')
  await fac.getByLabel('Action owner').fill(NAME_PAYLOAD)
  await fac.getByRole('button', { name: 'Add action' }).click()
  await expect(pat.getByText('=HYPERLINK("http://example.com","x")')).toBeVisible()
  await fac.getByRole('button', { name: 'Next topic', exact: true }).click()
  await fac.getByRole('button', { name: 'Start wrap-up' }).first().click()
  await pat.getByLabel('Your take-away').fill(PAYLOADS[0] ?? '')
  await pat.getByRole('button', { name: 'Share' }).click()
  await expect(fac.getByText(PAYLOADS[0] ?? '').first()).toBeVisible()
  for (const page of [fac, pat]) {
    expect(await page.locator('script:not([type="module"])').count()).toBe(0)
    expect(await page.locator('img[src="x"]').count()).toBe(0)
  }
  g1.check()
  g2.check()
})

async function anon(): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('sign-in failed')
  return { client, id: data.user.id }
}

const TABLES = [
  'boards',
  'board_state',
  'participants',
  'topics',
  'votes',
  'extend_rounds',
  'extend_votes',
  'actions',
  'takeaways',
  'failed_attempts',
]

test('direct API probing: outsiders, removed members and signed-out callers get nothing', async () => {
  test.setTimeout(120_000)
  const owner = await anon()
  const member = await anon()
  const removed = await anon()
  const outsider = await anon()
  const signedOut = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: made } = await owner.client.rpc('create_board', {
    p_display_name: 'Owner',
    p_name: `E2E probe ${Date.now()}`,
  })
  const { board_id: board, code } = made as { board_id: string; code: string }
  await member.client.rpc('join_board', { p_code: code, p_display_name: 'Member' })
  await removed.client.rpc('join_board', { p_code: code, p_display_name: 'Removed' })
  await owner.client.rpc('start_phase', { p_board: board, p_phase: 'brainstorm' })
  const { data: topic } = await owner.client.rpc('add_topic', {
    p_board: board,
    p_text: 'Probe topic',
  })
  await owner.client.rpc('start_phase', { p_board: board, p_phase: 'discuss' })
  await owner.client.rpc('start_discussion', { p_board: board })
  const { data: round } = await owner.client.rpc('open_extend_round', { p_board: board })
  const { data: action } = await owner.client.rpc('add_action', {
    p_board: board,
    p_text: 'Probe action',
  })
  await owner.client.rpc('remove_participant', { p_board: board, p_user: removed.id })

  const callers: [string, SupabaseClient][] = [
    ['outsider', outsider.client],
    ['removed member', removed.client],
    ['signed out', signedOut],
  ]

  // Reads: no rows, or a permission error.
  for (const [who, client] of callers) {
    for (const table of TABLES) {
      const { data, error } = await client.from(table).select('*')
      expect(error !== null || (data ?? []).length === 0, `${who} read ${table}`).toBe(true)
    }
  }
  // The member can read their board but never the secrets or the throttle log.
  expect((await member.client.from('board_state').select('*')).data?.length).toBe(1)
  for (const table of ['boards', 'failed_attempts']) {
    expect(
      (await member.client.from(table).select('*')).error,
      `member read ${table}`,
    ).not.toBeNull()
  }

  // Calls that act on the board: every one must fail for these callers.
  const B = { p_board: board }
  const calls: [string, Record<string, unknown>][] = [
    ['heartbeat', B],
    ['update_settings', { ...B, p_settings: { dots: 5 } }],
    ['set_passcode', { ...B, p_passcode: 'hijacked' }],
    ['lock_board', { ...B, p_locked: true }],
    ['lock_topics', { ...B, p_locked: true }],
    ['remove_participant', { ...B, p_user: member.id }],
    ['pass_facilitator', { ...B, p_to: outsider.id }],
    ['reclaim_facilitator', B],
    ['reclaim_facilitator', { ...B, p_token: 'x'.repeat(43) }],
    ['start_phase', { ...B, p_phase: 'wrapup' }],
    ['end_session', B],
    ['set_pitch', { ...B, p_topic: topic }],
    ['timer_pause', B],
    ['timer_resume', B],
    ['timer_adjust', { ...B, p_delta_s: 60 }],
    ['add_topic', { ...B, p_text: 'injected' }],
    ['edit_topic', { p_topic: topic, p_text: 'x' }],
    ['delete_topic', { p_topic: topic }],
    ['merge_topics', { p_source: topic, p_target: topic }],
    ['unmerge_topic', { p_topic: topic }],
    ['reorder_topics', { ...B, p_ids: [topic] }],
    ['cast_dots', { p_topic: topic, p_dots: 1 }],
    ['finish_voting', B],
    ['reveal_votes', B],
    ['vote_totals', B],
    ['start_tie_vote', { ...B, p_topics: [topic, topic] }],
    ['break_ties_random', B],
    ['revote', B],
    ['start_discussion', B],
    ['open_extend_round', B],
    ['cast_extend_vote', { p_round: round, p_choice: 'keep' }],
    ['resolve_extend_round', { p_round: round }],
    ['extend_topic', B],
    ['next_topic', B],
    ['add_action', { ...B, p_text: 'x' }],
    ['toggle_action', { p_action: action, p_done: true }],
    ['delete_action', { p_action: action }],
    ['set_takeaway', { ...B, p_text: 'x' }],
    ['close_brainstorm', B],
  ]
  for (const [who, client] of callers) {
    for (const [fn, args] of calls) {
      const { error } = await client.rpc(fn, args)
      expect(error, `${who} called ${fn}`).not.toBeNull()
    }
  }
  // Signed-out callers can reach only the two public helpers.
  for (const fn of ['create_board', 'lookup_board', 'join_board']) {
    const { error } = await signedOut.rpc(fn, { p_display_name: 'x', p_code: code })
    expect(error, `signed out called ${fn}`).not.toBeNull()
  }
  expect((await signedOut.rpc('keepalive')).data).toBe('ok')

  // Nothing changed for the real members.
  const state = (await member.client.from('board_state').select('*').single()).data as {
    phase: string
    locked: boolean
  }
  expect(state.phase).toBe('discuss')
  expect(state.locked).toBe(false)
  await owner.client.rpc('end_session', B)
})
