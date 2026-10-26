import { boardTotals, cards } from '../session'
import type { Topic } from '../types'
import type { BoardData } from '../../state/useBoard'

/**
 * Where a topic stands. "Being discussed" is the topic on stage when the file was made; "Partly
 * discussed" is an open topic that has had time on stage (deferred, or skipped and brought back).
 */
export type ExportStatus =
  'Discussed' | 'Being discussed' | 'Skipped' | 'Partly discussed' | 'Not discussed'

export interface ExportTopic {
  /** Position in the record: discussed in order, the topic on stage, the queue, then skipped. */
  rank: number
  text: string
  author: string
  votes: number
  status: ExportStatus
  /** Whole seconds, in ms. For the topic on stage, the time so far. */
  timeSpentMs: number
  extensions: number
}

export interface ExportAction {
  text: string
  owner: string
  /** The topic's text, or "Other actions" when the topic was deleted (as on the board). */
  topic: string
  done: boolean
}

export interface ActionGroup {
  topic: string
  actions: ExportAction[]
}

/** The board's heading for actions whose topic is gone (Discussed column, D75). */
export const OTHER_ACTIONS = 'Other actions'

export interface ExportModel {
  title: string
  /** When the session started, or the download time before it has. */
  date: Date
  /** `date` as a long date in the reader's locale; the file name uses the same local day. */
  dateText: string
  people: number
  minutes: number
  discussed: ExportTopic[]
  /** The topic on stage when the file was made, if any. */
  current: ExportTopic | null
  /** Open topics in the board's queue order, then skipped ones. */
  notDiscussed: ExportTopic[]
  all: ExportTopic[]
  /** Actions grouped by topic in board order, oldest first in each; Other actions last. */
  actionGroups: ActionGroup[]
  /** The same actions as one list, for the spreadsheet. */
  actions: ExportAction[]
  takeaways: { name: string; text: string }[]
}

const wholeSeconds = (ms: number) => Math.max(0, Math.round(ms / 1000) * 1000)

/**
 * Everything the Word and Excel files show, from the board as it is now. `now` should be the
 * server-corrected time (download() measures it), so the session length and the time so far on
 * stage match the toolbar and the clock.
 */
export function buildModel(data: BoardData, now: Date, locale?: string): ExportModel {
  const state = data.state
  if (!state) throw new Error('Board not loaded')
  // The same dots as the board: after a re-vote, discussed and skipped topics keep the dots that
  // ranked them, from the last earlier round they got any in.
  const totals = boardTotals(data.votes, data.topics, state.base_round)
  // The segment clock is selected with the rest of board_state but is not in its type.
  const segmentStart = (state as { timer_started_at?: string | null }).timer_started_at ?? null
  // Merged cards carry their duplicates' text so nothing written is lost.
  const merged = (id: string) => data.topics.filter((t) => t.merged_into === id)
  const list = cards(data.topics)
  const textOf = (t: Topic) => [t.text, ...merged(t.id).map((m) => m.text)].join(' / ')

  const statusOf = (t: Topic): ExportStatus =>
    t.status === 'discussed'
      ? 'Discussed'
      : t.status === 'discussing'
        ? 'Being discussed'
        : t.status === 'skipped'
          ? 'Skipped'
          : t.time_spent_ms >= 500
            ? 'Partly discussed'
            : 'Not discussed'
  const spentOf = (t: Topic) => {
    // The topic on stage adds its running segment, which the server books when it leaves.
    const running =
      t.status === 'discussing' && t.id === state.current_topic_id && segmentStart
        ? Math.max(0, now.getTime() - Date.parse(segmentStart))
        : 0
    return wholeSeconds(t.time_spent_ms + (Number.isFinite(running) ? running : 0))
  }
  const toRow = (t: Topic, rank: number): ExportTopic => ({
    rank,
    text: textOf(t),
    author: [t.author_name, ...merged(t.id).map((m) => m.author_name)]
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', '),
    votes: totals.get(t.id) ?? 0,
    status: statusOf(t),
    timeSpentMs: spentOf(t),
    extensions: t.extensions,
  })

  // Board order: Discussed in the order discussed, the stage, then To discuss (the queue in the
  // facilitator's order, then Skipped), as the columns show them.
  const ordered = [
    ...list
      .filter((t) => t.status === 'discussed')
      .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0)),
    ...list.filter((t) => t.status === 'discussing'),
    ...list.filter((t) => t.status === 'open'),
    ...list.filter((t) => t.status === 'skipped'),
  ]
  const all = ordered.map((t, i) => toRow(t, i + 1))
  const discussed = all.filter((t) => t.status === 'Discussed')
  const current = all.find((t) => t.status === 'Being discussed') ?? null

  // Actions under their topic, in board order and oldest first; a deleted or merged-away topic's
  // actions go under Other actions, as in the Discussed column.
  const byAge = data.actions
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const toAction = (a: (typeof byAge)[number], topic: string): ExportAction => ({
    text: a.text,
    owner: a.owner_name ?? '',
    topic,
    done: a.done,
  })
  const onBoard = new Set(ordered.map((t) => t.id))
  const actionGroups: ActionGroup[] = [
    ...ordered.map((t) => {
      const topic = textOf(t)
      return {
        topic,
        actions: byAge.filter((a) => a.topic_id === t.id).map((a) => toAction(a, topic)),
      }
    }),
    {
      topic: OTHER_ACTIONS,
      actions: byAge
        .filter((a) => a.topic_id === null || !onBoard.has(a.topic_id))
        .map((a) => toAction(a, OTHER_ACTIONS)),
    },
  ].filter((g) => g.actions.length > 0)

  const end = state.ended_at ? Date.parse(state.ended_at) : now.getTime()
  const date = state.started_at ? new Date(state.started_at) : now
  return {
    title: state.name || 'Lean Coffee',
    date,
    dateText: date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
    people: data.participants.length,
    minutes: state.started_at
      ? Math.max(0, Math.round((end - Date.parse(state.started_at)) / 60_000))
      : 0,
    discussed,
    current,
    notDiscussed: all.filter((t) => t.status !== 'Discussed' && t.status !== 'Being discussed'),
    all,
    actionGroups,
    actions: actionGroups.flatMap((g) => g.actions),
    takeaways: data.takeaways
      .filter((t) => !t.passed && t.text)
      .map((t) => ({ name: t.author_name, text: t.text ?? '' })),
  }
}

export function mss(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
