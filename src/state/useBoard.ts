import { useCallback, useEffect, useState } from 'react'
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
const TABLES = Object.keys(KEYS) as Table[]

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
}

const HEARTBEAT_MS = 20_000
const CLOCK_RESYNC_MS = 60_000

/**
 * Loads a board and keeps it current. Row changes arrive through Postgres Changes on a private
 * channel; RLS decides what each member may receive. A board_state change can change what is
 * visible elsewhere (phase, reveal), so it triggers a full reload; other changes reload one table.
 * Each load carries a sequence number so a slow, older response never overwrites a newer one.
 */
export function useBoard(boardId: string): UseBoard {
  const [data, setData] = useState<BoardData>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [gone, setGone] = useState(false)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [offsetMs, setOffsetMs] = useState(0)

  const loaders = useCallback(
    (isActive: () => boolean, onGone: () => void) => {
      const latest = new Map<string, number>()
      let seq = 0
      const ticket = (key: string) => {
        const n = ++seq
        latest.set(key, n)
        return () => isActive() && latest.get(key) === n
      }

      const loadTable = async (table: Table) => {
        const current = ticket(table)
        const { data: rows, error } = await supabase.from(table).select('*').eq('board_id', boardId)
        if (!error && current()) setData((d) => ({ ...d, [KEYS[table]]: rows ?? [] }))
      }

      const refresh = async () => {
        const current = ticket('board_state')
        const { data: state, error } = await supabase
          .from('board_state')
          .select('*')
          .eq('board_id', boardId)
          .maybeSingle()
        if (error || !current()) return
        if (!state) return onGone()
        setData((d) => ({ ...d, state: state as BoardState }))
        await Promise.all(TABLES.map(loadTable))
        if (isActive()) setLoaded(true)
      }

      const syncClock = async () => {
        const sent = Date.now()
        try {
          const server = await rpc<string>('server_time')
          if (isActive()) setOffsetMs(measureOffset(Date.parse(server), sent, Date.now()))
        } catch {
          // Keep the previous offset; the next resync will try again.
        }
      }

      const beat = async () => {
        try {
          await rpc('heartbeat', { p_board: boardId })
        } catch (e) {
          if (e instanceof Error && 'code' in e && e.code === 'not_member') onGone()
        }
      }

      return { loadTable, refresh, syncClock, beat }
    },
    [boardId],
  )

  useEffect(() => {
    // Per-effect flag: under StrictMode the first run is torn down before its async work ends.
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    const timers: number[] = []

    const stop = () => {
      active = false
      timers.forEach((t) => window.clearInterval(t))
      if (channel) void supabase.removeChannel(channel)
    }
    const onGone = () => {
      if (!active) return
      stop()
      setGone(true)
    }
    const { loadTable, refresh, syncClock, beat } = loaders(() => active, onGone)

    void refresh()
    void syncClock()
    void beat()
    timers.push(
      window.setInterval(beat, HEARTBEAT_MS),
      window.setInterval(syncClock, CLOCK_RESYNC_MS),
    )

    void (async () => {
      await supabase.realtime.setAuth()
      if (!active) return
      channel = supabase.channel(`board:${boardId}`, { config: { private: true } })
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_state', filter: `board_id=eq.${boardId}` },
        () => void refresh(),
      )
      for (const table of TABLES) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `board_id=eq.${boardId}` },
          () => void loadTable(table),
        )
      }
      channel.subscribe((status) => {
        if (!active) return
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

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !active) return
      void beat()
      void refresh()
      void syncClock()
    }
    const onOnline = () => {
      if (!active) return
      // The socket may have survived a brief offline blip without a status change.
      if (channel?.state === 'joined') setConnection('live')
      onVisible()
    }
    const onOffline = () => {
      if (active) setConnection('reconnecting')
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [boardId, loaders])

  return { data, loaded, gone, connection, offsetMs }
}
