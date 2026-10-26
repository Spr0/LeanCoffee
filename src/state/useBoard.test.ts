import { act, renderHook, waitFor } from '@testing-library/react'
import { useBoard } from './useBoard'

type Handler = { kind: string; table?: string; run: (payload: unknown) => void }

// A stand-in for the Supabase client: each table answers from `rows` (or an error from `fail`),
// or waits on `held` until the test lets it go; every read is logged in `reads`. The channel keeps
// its handlers so the test can fire them, and `rpc` answers from `rpcs`.
const db = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  held: {} as Record<string, Promise<unknown>>,
  fail: {} as Record<string, number>,
  reads: [] as string[],
  handlers: [] as Handler[],
  rpcs: {} as Record<string, () => unknown>,
  connected: true,
  socket: [] as string[],
  notMember: [] as ((fn: string) => void)[],
}))

vi.mock('../lib/supabase', () => {
  const answer = async (table: string) => {
    db.reads.push(table)
    if (db.fail[table]) {
      db.fail[table]--
      return { data: null, error: { message: 'Bad gateway' } }
    }
    const held = db.held[table]
    return { data: held ? await held : db.rows[table], error: null }
  }
  const channel = {
    state: 'joined',
    on: (kind: string, filter: { table?: string }, run: (payload: unknown) => void) => {
      db.handlers.push({ kind, table: filter.table, run })
      return channel
    },
    subscribe: () => channel,
  }
  class AppError extends Error {
    readonly code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
  return {
    AppError,
    onNotMember: (listener: (fn: string) => void) => {
      db.notMember.push(listener)
      return () => db.notMember.splice(db.notMember.indexOf(listener), 1)
    },
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            const result = answer(table)
            const query = Object.assign(result, {
              maybeSingle: () => result,
              order: () => query,
            })
            return query
          },
        }),
      }),
      channel: () => channel,
      removeChannel: async () => {},
      auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
      realtime: {
        setAuth: async () => {},
        isConnected: () => db.connected,
        isConnecting: () => false,
        disconnect: async () => {
          db.socket.push('disconnect')
          return 'ok'
        },
        connect: () => db.socket.push('connect'),
      },
    },
    rpc: async (fn: string) => {
      const run = db.rpcs[fn]
      if (run) return run()
      return new Date().toISOString()
    },
  }
})

const TABLES = ['participants', 'topics', 'extend_rounds', 'extend_votes', 'actions', 'takeaways']
const mine = { id: 'v1', topic_id: 't1', user_id: 'me', round: 0, dots: 1 }
const theirs = { id: 'v2', topic_id: 't1', user_id: 'you', round: 0, dots: 2 }
const STATE = {
  board_id: 'b1',
  phase: 'vote',
  vote_round: 0,
  votes_revealed_at: null,
  current_topic_id: null,
  last_activity_at: '2026-10-26T10:00:00Z',
}

/** Fires a board_state UPDATE the way Realtime sends it. */
function stateEvent(row: Record<string, unknown>) {
  const handler = db.handlers.find(
    (h) => h.kind === 'postgres_changes' && h.table === 'board_state',
  )
  act(() => handler?.run({ eventType: 'UPDATE', new: row, old: {}, errors: null }))
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

async function mount() {
  const hook = renderHook(() => useBoard('b1'))
  await waitFor(() => expect(hook.result.current.loaded).toBe(true))
  await waitFor(() => expect(db.handlers.length).toBeGreaterThan(0))
  await settle()
  db.reads = []
  return hook
}

describe('useBoard', () => {
  beforeEach(() => {
    for (const t of TABLES) db.rows[t] = []
    db.rows.participants = [{ id: 'p1', user_id: 'me', board_id: 'b1' }]
    db.rows.board_state = { ...STATE }
    db.rows.votes = [mine]
    db.held = {}
    db.fail = {}
    db.reads = []
    db.handlers = []
    db.rpcs = {}
    db.connected = true
    db.socket = []
    db.notMember = []
  })

  it('shows a new board state only with the tables reloaded for it', async () => {
    const { result } = await mount()
    stateEvent({ ...STATE })

    // The reveal: everyone's dots are readable now, but the votes answer slowly.
    let release: (rows: unknown) => void = () => {}
    db.held.votes = new Promise((resolve) => (release = resolve))
    const revealed = { ...STATE, votes_revealed_at: '2026-10-26T10:05:00Z' }
    db.rows.board_state = revealed
    stateEvent(revealed)
    await settle()
    // Not revealed with only the viewer's own dot, which would read as the totals.
    expect(result.current.data.state?.votes_revealed_at).toBeNull()
    expect(result.current.data.votes).toEqual([mine])

    await act(async () => release([mine, theirs]))
    await waitFor(() => expect(result.current.data.state?.votes_revealed_at).not.toBeNull())
    expect(result.current.data.votes).toEqual([mine, theirs])
  })

  it('reloads only what a board change governs', async () => {
    const { result } = await mount()
    stateEvent({ ...STATE })
    await settle()
    db.reads = []

    // The activity stamp alone: a write somewhere. Deleted actions and removed people send no
    // event of their own, so those two tables reload; the state and the rest do not.
    db.rows.actions = []
    stateEvent({ ...STATE, last_activity_at: '2026-10-26T10:01:00Z' })
    await settle()
    expect(db.reads.sort()).toEqual(['actions', 'participants'])
    db.reads = []

    // A topic on stage: the state alone (the topics table sends its own change).
    db.rows.board_state = { ...STATE, current_topic_id: 't1' }
    stateEvent({ ...STATE, last_activity_at: '2026-10-26T10:01:00Z', current_topic_id: 't1' })
    await waitFor(() => expect(result.current.data.state?.current_topic_id).toBe('t1'))
    expect(db.reads).toEqual(['board_state'])

    // A phase change can show topics that were hidden: the state and the topics, together.
    db.reads = []
    db.rows.topics = [{ id: 't9', text: 'Hidden until now' }]
    const stamp = { last_activity_at: '2026-10-26T10:01:00Z' }
    db.rows.board_state = { ...STATE, current_topic_id: 't1', phase: 'clarify' }
    stateEvent({ ...STATE, ...stamp, current_topic_id: 't1', phase: 'clarify' })
    await waitFor(() => expect(result.current.data.state?.phase).toBe('clarify'))
    expect(result.current.data.topics).toEqual([{ id: 't9', text: 'Hidden until now' }])
    expect(db.reads.sort()).toEqual(['board_state', 'topics'])

    // A deleted topic takes its votes and extend rounds with it.
    db.reads = []
    const fewer = { ...STATE, ...stamp, current_topic_id: 't1', phase: 'clarify', topic_count: 3 }
    db.rows.board_state = fewer
    stateEvent(fewer)
    await settle()
    expect(db.reads.sort()).toEqual(
      ['board_state', 'extend_rounds', 'extend_votes', 'topics', 'votes'].sort(),
    )
  })

  it('reloads one table for a change to it', async () => {
    const { result } = await mount()
    db.rows.actions = [{ id: 'a1', text: 'Write it up' }]
    const handler = db.handlers.find((h) => h.table === 'actions')
    act(() => handler?.run({ eventType: 'INSERT' }))
    await waitFor(() => expect(result.current.data.actions).toHaveLength(1))
    expect(db.reads).toEqual(['actions'])
  })

  it('tries a failed board read again instead of staying on Loading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      db.fail.board_state = 1
      const { result } = renderHook(() => useBoard('b1'))
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(result.current.loaded).toBe(false)
      await act(() => vi.advanceTimersByTimeAsync(2_100))
      await waitFor(() => expect(result.current.loaded).toBe(true))
      expect(result.current.data.votes).toEqual([mine])
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloads everything when the server confirms changes are streaming', async () => {
    await mount()
    const system = db.handlers.find((h) => h.kind === 'system')
    act(() => system?.run({ extension: 'postgres_changes', status: 'ok', message: '' }))
    await settle()
    expect(db.reads.sort()).toEqual(['board_state', ...TABLES, 'votes'].sort())
  })

  it('leaves the board as soon as the people list no longer includes the viewer', async () => {
    const { result } = await mount()
    const beats: string[] = []
    db.rpcs.heartbeat = () => {
      beats.push('heartbeat')
      throw Object.assign(new Error('not_member'), { code: 'not_member' })
    }
    db.rows.participants = []
    const handler = db.handlers.find((h) => h.table === 'participants')
    act(() => handler?.run({ eventType: 'DELETE' }))
    await waitFor(() => expect(result.current.gone).toBe(true))
    expect(beats).toEqual(['heartbeat'])
  })

  it('asks the server at once when an action is refused as not a member', async () => {
    const { result } = await mount()
    db.rpcs.heartbeat = () => {
      throw Object.assign(new Error('not_member'), { code: 'not_member' })
    }
    // The heartbeat's own refusal does not start another one.
    act(() => db.notMember.forEach((listener) => listener('heartbeat')))
    await settle()
    expect(result.current.gone).toBe(false)
    act(() => db.notMember.forEach((listener) => listener('add_action')))
    await waitFor(() => expect(result.current.gone).toBe(true))
  })

  it('reconnects Realtime at once when the network comes back', async () => {
    await mount()
    act(() => void window.dispatchEvent(new Event('online')))
    expect(db.socket).toEqual([])

    db.connected = false
    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(db.socket).toEqual(['disconnect', 'connect']))
  })
})
