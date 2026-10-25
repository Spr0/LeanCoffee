import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, supabase } from '../lib/supabase'
import { measureOffset } from '../lib/time'
import type {
  Action,
  BoardState,
  ExtendRound,
  ExtendVote,
  Participant,
  Takeaway,
  Topic,
  Vote,
} from '../lib/types'

export interface BoardData {
  state: BoardState | null
  participants: Participant[]
  topics: Topic[]
  votes: Vote[]
  extendRounds: ExtendRound[]
  extendVotes: ExtendVote[]
  actions: Action[]
  takeaways: Takeaway[]
}

type Table =
  'participants' | 'topics' | 'votes' | 'extend_rounds' | 'extend_votes' | 'actions' | 'takeaways'

const KEYS: Record<Table, keyof BoardData> = {
  participants: 'participants',
  topics: 'topics',
  votes: 'votes',
  extend_rounds: 'extendRounds',
  extend_votes: 'extendVotes',
  actions: 'actions',
  takeaways: 'takeaways',
}

const EMPTY: BoardData = {
  state: null,
  participants: [],
  topics: [],
  votes: [],
  extendRounds: [],
  extendVotes: [],
  actions: [],
  takeaways: [],
}

export type Connection = 'connecting' | 'live' | 'reconnecting'

export interface UseBoard {
  data: BoardData
  loaded: boolean
  /** Signed-in user is no longer a member (removed, or the board was deleted). */
  gone: boolean
  connection: Connection
  offsetMs: number
  refresh: () => Promise<void>
}

const HEARTBEAT_MS = 20_000
const CLOCK_RESYNC_MS = 60_000

/**
 * Loads a board and keeps it current. Row changes arrive through Postgres Changes on a private
 * channel; RLS decides what each member may receive. A board_state change can change what is
 * visible elsewhere (phase, reveal), so it triggers a full reload; other changes reload one table.
 */
export function useBoard(boardId: string): UseBoard {
  const [data, setData] = useState<BoardData>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [gone, setGone] = useState(false)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [offsetMs, setOffsetMs] = useState(0)
  const alive = useRef(true)

  const loadTable = useCallback(
    async (table: Table) => {
      const { data: rows, error } = await supabase.from(table).select('*').eq('board_id', boardId)
      if (!error && alive.current) setData((d) => ({ ...d, [KEYS[table]]: rows ?? [] }))
    },
    [boardId],
  )

  const refresh = useCallback(async () => {
    const { data: state, error } = await supabase
      .from('board_state')
      .select('*')
      .eq('board_id', boardId)
      .maybeSingle()
    if (!alive.current || error) return
    if (!state) {
      setGone(true)
      return
    }
    setData((d) => ({ ...d, state: state as BoardState }))
    await Promise.all((Object.keys(KEYS) as Table[]).map(loadTable))
    if (alive.current) setLoaded(true)
  }, [boardId, loadTable])

  const syncClock = useCallback(async () => {
    const sent = Date.now()
    try {
      const server = await rpc<string>('server_time')
      if (alive.current) setOffsetMs(measureOffset(Date.parse(server), sent, Date.now()))
    } catch {
      // Keep the previous offset; the next resync will try again.
    }
  }, [])

  useEffect(() => {
    alive.current = true
    // Initial load from the database (an external system); state is set when the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    void syncClock()

    let channel: ReturnType<typeof supabase.channel> | null = null
    void (async () => {
      await supabase.realtime.setAuth()
      if (!alive.current) return
      channel = supabase.channel(`board:${boardId}`, { config: { private: true } })
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_state', filter: `board_id=eq.${boardId}` },
        () => void refresh(),
      )
      for (const table of Object.keys(KEYS) as Table[]) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `board_id=eq.${boardId}` },
          () => void loadTable(table),
        )
      }
      channel.subscribe((status) => {
        if (!alive.current) return
        if (status === 'SUBSCRIBED') {
          setConnection('live')
          // Anything missed while disconnected is reloaded.
          void refresh()
          void syncClock()
        } else {
          setConnection('reconnecting')
        }
      })
    })()

    const beat = async () => {
      try {
        await rpc('heartbeat', { p_board: boardId })
      } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === 'not_member') setGone(true)
      }
    }
    void beat()
    const heartbeat = window.setInterval(beat, HEARTBEAT_MS)
    const clock = window.setInterval(syncClock, CLOCK_RESYNC_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void beat()
        void refresh()
        void syncClock()
      }
    }
    const onOffline = () => setConnection('reconnecting')
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener('offline', onOffline)

    return () => {
      alive.current = false
      window.clearInterval(heartbeat)
      window.clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('offline', onOffline)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [boardId, refresh, loadTable, syncClock])

  return { data, loaded, gone, connection, offsetMs, refresh }
}
