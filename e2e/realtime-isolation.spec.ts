import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

// Security matrix, "receive realtime for the board": members yes, non-members and removed members no.
const url = process.env.VITE_SUPABASE_URL ?? ''
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

async function anonClient(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('anonymous sign-in failed')
  return { client, userId: data.user.id }
}

async function listen(client: SupabaseClient, boardId: string, events: string[]) {
  await client.realtime.setAuth()
  const channel = client.channel(`board:${boardId}`, { config: { private: true } })
  for (const table of ['board_state', 'participants', 'topics']) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `board_id=eq.${boardId}` },
      (p) => events.push(`${table}:${p.eventType}`),
    )
  }
  const status = await new Promise<string>((resolve) => {
    channel.subscribe((s) => {
      if (s !== 'CLOSED') resolve(s)
    })
    setTimeout(() => resolve('TIMEOUT'), 10_000)
  })
  return { channel, status }
}

test('non-members and removed members receive no realtime events', async () => {
  test.skip(!url || !key, 'Supabase env not set')
  const owner = await anonClient()
  const member = await anonClient()
  const outsider = await anonClient()

  const { data: made, error } = await owner.client.rpc('create_board', {
    p_display_name: 'Owner',
    p_name: `E2E realtime ${Date.now()}`,
  })
  expect(error).toBeNull()
  const { board_id: boardId, code } = made as { board_id: string; code: string }
  await member.client.rpc('join_board', { p_code: code, p_display_name: 'Member' })

  const memberEvents: string[] = []
  const outsiderEvents: string[] = []
  const m = await listen(member.client, boardId, memberEvents)
  const o = await listen(outsider.client, boardId, outsiderEvents)
  expect(m.status).toBe('SUBSCRIBED')
  // A private channel for a board you do not belong to is refused or stays silent.
  expect(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'TIMEOUT']).toContain(o.status)

  await owner.client.rpc('update_settings', { p_board: boardId, p_settings: { vote_s: 120 } })
  await owner.client.rpc('start_phase', { p_board: boardId, p_phase: 'brainstorm' })
  await owner.client.rpc('add_topic', { p_board: boardId, p_text: 'Hidden from everyone else' })
  await expect.poll(() => memberEvents.length, { timeout: 10_000 }).toBeGreaterThan(0)
  await new Promise((r) => setTimeout(r, 2000))
  expect(outsiderEvents).toEqual([])
  // The member gets state changes but not the owner's hidden Brainstorm topic.
  expect(memberEvents.filter((e) => e.startsWith('topics:'))).toEqual([])

  // After removal, the former member stops receiving events.
  await owner.client.rpc('remove_participant', { p_board: boardId, p_user: member.userId })
  await new Promise((r) => setTimeout(r, 1500))
  memberEvents.length = 0
  await owner.client.rpc('update_settings', { p_board: boardId, p_settings: { vote_s: 90 } })
  await new Promise((r) => setTimeout(r, 3000))
  expect(memberEvents).toEqual([])

  // An outsider on a public (non-private) channel with no row filter: inserts and updates are
  // still filtered by RLS. Deletes are not (Supabase limitation, decision D19): they carry only
  // the row's random id, never content.
  const publicEvents: { type: string; payload: string }[] = []
  await outsider.client.realtime.setAuth()
  const pub = outsider.client.channel(`snoop-${Date.now()}`)
  for (const table of ['board_state', 'participants', 'topics', 'actions'])
    pub.on('postgres_changes', { event: '*', schema: 'public', table }, (p) =>
      publicEvents.push({ type: `${table}:${p.eventType}`, payload: JSON.stringify(p) }),
    )
  await new Promise<void>((resolve) => {
    pub.subscribe((s) => s !== 'CLOSED' && resolve())
    setTimeout(resolve, 10_000)
  })
  const { data: topicId } = await owner.client.rpc('add_topic', {
    p_board: boardId,
    p_text: 'Secret parking-lot topic',
  })
  await owner.client.rpc('start_phase', { p_board: boardId, p_phase: 'clarify' })
  await owner.client.rpc('delete_topic', { p_topic: topicId })
  await new Promise((r) => setTimeout(r, 3000))
  expect(publicEvents.filter((e) => !e.type.endsWith(':DELETE'))).toEqual([])
  for (const e of publicEvents) expect(e.payload).not.toContain('Secret parking-lot topic')

  await owner.client.rpc('end_session', { p_board: boardId })
  for (const c of [owner, member, outsider]) await c.client.removeAllChannels()
})
