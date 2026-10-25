import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

// Load smoke (prompt 7.5): 12 clients, each with a live realtime subscription, run one full
// session concurrently. Passes when no call fails and every client keeps receiving updates.
const url = process.env.VITE_SUPABASE_URL ?? ''
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

interface Person {
  name: string
  client: SupabaseClient
  id: string
  events: number
  statuses: string[]
  channel?: RealtimeChannel
}

test('12 people run a session at once without errors', async () => {
  test.setTimeout(180_000)
  const errors: string[] = []
  const people: Person[] = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data, error } = await client.auth.signInAnonymously()
      if (error || !data.user) throw error ?? new Error('sign-in failed')
      return { name: `Person ${i + 1}`, client, id: data.user.id, events: 0, statuses: [] }
    }),
  )
  const owner = people[0]
  if (!owner) throw new Error('no owner')
  const call = async (p: Person, fn: string, args: Record<string, unknown>) => {
    const { data, error } = await p.client.rpc(fn, args)
    if (error) errors.push(`${p.name} ${fn}: ${error.message}`)
    return data
  }
  const all = (fn: (p: Person, i: number) => Promise<unknown>) => Promise.all(people.map(fn))

  const made = (await call(owner, 'create_board', {
    p_display_name: owner.name,
    p_name: `E2E load ${Date.now()}`,
  })) as {
    board_id: string
    code: string
  }
  const B = { p_board: made.board_id }
  await all((p) =>
    p === owner
      ? Promise.resolve()
      : call(p, 'join_board', { p_code: made.code, p_display_name: p.name }),
  )

  await all(async (p) => {
    await p.client.realtime.setAuth()
    p.channel = p.client.channel(`board:${made.board_id}`, { config: { private: true } })
    for (const table of [
      'board_state',
      'participants',
      'topics',
      'votes',
      'extend_rounds',
      'extend_votes',
      'actions',
      'takeaways',
    ])
      p.channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `board_id=eq.${made.board_id}` },
        () => {
          p.events++
        },
      )
    await new Promise<void>((resolve) => {
      p.channel?.subscribe((s) => {
        p.statuses.push(s)
        if (s === 'SUBSCRIBED') resolve()
      })
      setTimeout(resolve, 15_000)
    })
  })
  expect(
    people.every((p) => p.statuses.includes('SUBSCRIBED')),
    'all subscribed',
  ).toBe(true)

  await all((p) => call(p, 'heartbeat', B))
  await call(owner, 'start_phase', { ...B, p_phase: 'brainstorm' })
  await all((p) => call(p, 'add_topic', { ...B, p_text: `Topic from ${p.name}` }))
  await call(owner, 'start_phase', { ...B, p_phase: 'clarify' })
  await call(owner, 'start_phase', { ...B, p_phase: 'vote' })
  const { data: topics } = await owner.client
    .from('topics')
    .select('id, author_user_id')
    .eq('board_id', made.board_id)
  // Everyone puts 3 dots on the next person's topic, all at once.
  await all(async (p, i) => {
    const target = topics?.find((t) => t.author_user_id === people[(i + 1) % people.length]?.id)
    await call(p, 'cast_dots', { p_topic: target?.id, p_dots: 3 })
    await call(p, 'finish_voting', B)
  })
  const revealed = (await owner.client.from('board_state').select('votes_revealed_at').single())
    .data
  expect(revealed?.votes_revealed_at, 'auto-revealed when everyone finished').not.toBeNull()
  await call(owner, 'start_phase', { ...B, p_phase: 'discuss' })
  await call(owner, 'start_discussion', B)
  const round = await call(owner, 'open_extend_round', B)
  await all((p, i) =>
    call(p, 'cast_extend_vote', { p_round: round, p_choice: i < 8 ? 'keep' : 'move_on' }),
  )
  await all((p) => call(p, 'add_action', { ...B, p_text: `Action from ${p.name}` }))
  await call(owner, 'next_topic', B)
  await call(owner, 'start_phase', { ...B, p_phase: 'wrapup' })
  await all((p) => call(p, 'set_takeaway', { ...B, p_text: `Take-away from ${p.name}` }))
  await call(owner, 'end_session', B)
  await new Promise((r) => setTimeout(r, 3000))

  expect(errors).toEqual([])
  const { data: extended } = await owner.client
    .from('topics')
    .select('extensions')
    .eq('board_id', made.board_id)
    .eq('status', 'discussed')
  expect(extended?.[0]?.extensions, 'keep-going majority extended the topic').toBe(1)
  for (const p of people) {
    expect(
      p.statuses.filter((s) => s !== 'SUBSCRIBED'),
      `${p.name} channel problems`,
    ).toEqual([])
    expect(p.events, `${p.name} received updates`).toBeGreaterThan(30)
  }
  await Promise.all(people.map((p) => p.client.removeAllChannels()))
})
