import type { RealtimePostgresChangesPayload, RealtimeSystemPayload } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { coalesce } from '../lib/coalesce'
import { onNotMember, rpc, supabase } from '../lib/supabase'
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

export type Table =
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

type Row = Record<string, unknown>

/**
 * Board state columns whose change needs other tables reloaded with the state. Most change which
 * rows this member may read (the RLS policies): other people's topics are hidden during
 * Brainstorm, and votes open at the reveal and for earlier rounds. topic_count also drops when a
 * topic is deleted, which takes its votes and extend votes with it, and Realtime sends no DELETE
 * event through a board filter.
 */
const GOVERNS: Partial<Record<string, Table[]>> = {
  phase: ['topics'],
  settings: ['topics'],
  vote_round: ['votes'],
  votes_revealed_at: ['votes'],
  topic_count: ['topics', 'votes', 'extend_rounds', 'extend_votes'],
}
/**
 * Every write stamps last_activity_at. A row change sends its own event, but a deleted action or a
 * removed person sends none (see GOVERNS), so a stamp alone reloads those two tables.
 */
const STAMP = 'last_activity_at'
const STAMPED: Table[] = ['participants', 'actions']

export type Connection = 'connecting' | 'live' | 'reconnecting'

export interface UseBoard {
  data: BoardData
  loaded: boolean
  /** Signed-in user is no longer a member (removed, or the board was deleted). */
  gone: boolean
  connection: Connection
  offsetMs: number
  /** Reloads one table now, for screens that must see their own write before the next action. */
  reload: (table: Table) => Promise<void>
}

const HEARTBEAT_MS = 20_000
const CLOCK_RESYNC_MS = 60_000
/** A failed read is tried again after this, doubling up to RETRY_MAX_MS while it keeps failing. */
const RETRY_MS = 2_000
const RETRY_MAX_MS = 30_000

/**
 * Loads a board and keeps it current. Row changes arrive through Postgres Changes on a private
 * channel; RLS decides what each member may receive. A change to a table reloads that table. A
 * board_state change reloads the state, together with any table it governs (GOVERNS), and the two
 * are shown at once: a reveal shown before the votes reload would show the viewer's own dots as
 * the totals. The activity stamp alone reloads only the tables whose deletes send no event.
 * Each load carries a sequence number so a slow, older response never overwrites a newer one, and
 * each table (and the state) has one load at a time with one more queued, so a burst of changes,
 * such as the reveal re-ranking every topic, does not send a request per row.
 */
export function useBoard(boardId: string): UseBoard {
  const [data, setData] = useState<BoardData>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [gone, setGone] = useState(false)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [offsetMs, setOffsetMs] = useState(0)
  const reloader = useRef<(table: Table) => Promise<void>>(async () => {})
  const reload = useCallback((table: Table) => reloader.current(table), [])

  const loaders = useCallback(
    (isActive: () => boolean, onGone: () => void) => {
      const latest = new Map<string, number>()
      let seq = 0
      const ticket = (key: string) => {
        const n = ++seq
        latest.set(key, n)
        return () => isActive() && latest.get(key) === n
      }

      const beat = async () => {
        try {
          await rpc('heartbeat', { p_board: boardId })
        } catch (e) {
          if (e instanceof Error && 'code' in e && e.code === 'not_member') onGone()
        }
      }

      // Removed people stop receiving the board, but the participants list still reloads (to
      // empty): ask the server at once rather than at the next heartbeat.
      const me = supabase.auth
        .getSession()
        .then(({ data: s }) => s.session?.user.id ?? null)
        .catch(() => null)
      const checkMember = async (rows: unknown[]) => {
        const id = await me
        if (id && isActive() && !(rows as Participant[]).some((p) => p.user_id === id)) void beat()
      }

      // Tables still to load with the state. A failed read joins them and is tried again later,
      // backing off while it keeps failing.
      const pending = new Set<Table>(TABLES)
      let retryMs = RETRY_MS
      let retryTimer = 0
      const retryLater = (tables: Table[], always = false) => {
        for (const t of tables) pending.add(t)
        if ((!always && tables.length === 0) || retryTimer || !isActive()) return
        retryTimer = window.setTimeout(() => {
          retryTimer = 0
          if (isActive()) void runRefresh()
        }, retryMs)
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      }

      // Rows of one table, or null on an error; `current` is false once a newer load has started.
      const fetchTable = async (table: Table) => {
        const current = ticket(table)
        const { data: rows, error } = await supabase.from(table).select('*').eq('board_id', boardId)
        return { table, rows: error ? null : (rows ?? []), current }
      }

      const runRefresh = coalesce(async () => {
        const tables = [...pending]
        pending.clear()
        const current = ticket('board_state')
        const { data: state, error } = await supabase
          .from('board_state')
          .select('*')
          .eq('board_id', boardId)
          .maybeSingle()
        if (!current()) return
        // This read supersedes any older one, so it must not fail silently: the board would stay
        // on "Loading the board…" until something else changed.
        if (error) return retryLater(tables, true)
        if (!state) return onGone()
        const results = await Promise.all(tables.map(fetchTable))
        if (!isActive()) return
        retryLater(results.filter((r) => !r.rows).map((r) => r.table))
        if (pending.size === 0) retryMs = RETRY_MS
        const fresh = results.filter((r) => r.rows && r.current())
        setData((d) => {
          const next = { ...d, state: state as BoardState }
          for (const { table, rows } of fresh) Object.assign(next, { [KEYS[table]]: rows })
          return next
        })
        setLoaded(true)
        const people = fresh.find((r) => r.table === 'participants')?.rows
        if (people) void checkMember(people)
      })
      /** Reloads the state and, shown with it, `tables` (all of them by default). */
      const refresh = (tables: readonly Table[] = TABLES) => {
        for (const t of tables) pending.add(t)
        return runRefresh()
      }

      const loads = Object.fromEntries(
        TABLES.map((table) => [
          table,
          coalesce(async () => {
            const { rows, current } = await fetchTable(table)
            if (!rows) return retryLater([table])
            if (!current()) return
            setData((d) => ({ ...d, [KEYS[table]]: rows }))
            if (table === 'participants') void checkMember(rows)
          }),
        ]),
      ) as Record<Table, () => Promise<void>>
      const loadTable = (table: Table) => loads[table]()

      // The last board_state row Realtime sent, to see which columns an update changed. Rows are
      // compared only with rows from the same source, whose formats match.
      let lastRow: Row | null = null
      const onStateChange = (payload: RealtimePostgresChangesPayload<Row>) => {
        const prev = lastRow
        const row = payload.eventType === 'DELETE' ? null : payload.new
        lastRow = row
        if (!prev || !row || payload.eventType !== 'UPDATE' || payload.errors) {
          void refresh()
          return
        }
        const changed = Object.keys({ ...prev, ...row }).filter(
          (k) => JSON.stringify(prev[k]) !== JSON.stringify(row[k]),
        )
        if (changed.some((k) => k !== STAMP)) {
          void refresh(changed.flatMap((k) => GOVERNS[k] ?? []))
        } else if (changed.length > 0) {
          for (const t of STAMPED) void loadTable(t)
        }
      }
      const forgetLastRow = () => {
        lastRow = null
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

      const stopRetry = () => window.clearTimeout(retryTimer)

      return { loadTable, refresh, onStateChange, forgetLastRow, syncClock, beat, stopRetry }
    },
    [boardId],
  )

  useEffect(() => {
    // Per-effect flag: under StrictMode the first run is torn down before its async work ends.
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    const timers: number[] = []
    const { loadTable, refresh, onStateChange, forgetLastRow, syncClock, beat, stopRetry } =
      loaders(
        () => active,
        () => onGone(),
      )

    const stop = () => {
      active = false
      timers.forEach((t) => window.clearInterval(t))
      stopRetry()
      if (channel) void supabase.removeChannel(channel)
    }
    const onGone = () => {
      if (!active) return
      stop()
      setGone(true)
    }
    reloader.current = loadTable

    void refresh()
    void syncClock()
    void beat()
    // A refused action is often the first sign of a removal: ask the server now, not at the next
    // heartbeat, so the removed screen shows instead of an error.
    const offNotMember = onNotMember((fn) => {
      if (active && fn !== 'heartbeat') void beat()
    })
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
        onStateChange,
      )
      for (const table of TABLES) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `board_id=eq.${boardId}` },
          () => void loadTable(table),
        )
      }
      // SUBSCRIBED only means the channel joined. The server can take a while longer to stream
      // row changes (seconds on a cold or restarted Realtime), and a change made in that gap is
      // never delivered, so the reload on SUBSCRIBED can miss it. The server says when changes
      // flow; reload again then.
      channel.on('system', {}, (msg: RealtimeSystemPayload) => {
        if (active && msg.extension === 'postgres_changes' && msg.status === 'ok') void refresh()
      })
      channel.subscribe((status) => {
        if (!active) return
        // Events may have been missed: compare the next one with a fresh reload, not an old row.
        forgetLastRow()
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
      // After a longer drop it is closed and waits out a backoff of up to several seconds before
      // the next try, missing changes made meanwhile: reconnect now.
      const realtime = supabase.realtime
      if (!realtime.isConnected() && !realtime.isConnecting()) {
        void realtime.disconnect().then(() => {
          if (active) realtime.connect()
        })
      }
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
      offNotMember()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [boardId, loaders])

  return { data, loaded, gone, connection, offsetMs, reload }
}
