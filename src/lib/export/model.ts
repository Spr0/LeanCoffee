import { cards, dotTotals } from '../session'
import type { BoardData } from '../../state/useBoard'

export interface ExportTopic {
  rank: number
  text: string
  author: string
  votes: number
  status: 'Discussed' | 'Skipped' | 'Not discussed'
  timeSpentMs: number
  extensions: number
}

export interface ExportModel {
  title: string
  date: Date
  people: number
  minutes: number
  discussed: ExportTopic[]
  notDiscussed: ExportTopic[]
  all: ExportTopic[]
  actions: { text: string; owner: string; topic: string; done: boolean }[]
  takeaways: { name: string; text: string }[]
}

/** Everything the Word and Excel files show, from the final board state. */
export function buildModel(data: BoardData, now: Date): ExportModel {
  const state = data.state
  if (!state) throw new Error('Board not loaded')
  const totals = dotTotals(data.votes, state.base_round)
  // Merged cards carry their duplicates' text so nothing written is lost.
  const merged = (id: string) => data.topics.filter((t) => t.merged_into === id).map((t) => t.text)
  const list = cards(data.topics)
  const toRow = (t: (typeof list)[number]): Omit<ExportTopic, 'rank'> => ({
    text: [t.text, ...merged(t.id)].join(' / '),
    author: [
      t.author_name,
      ...data.topics.filter((m) => m.merged_into === t.id).map((m) => m.author_name),
    ]
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', '),
    votes: totals.get(t.id) ?? 0,
    status:
      t.status === 'discussed' ? 'Discussed' : t.status === 'skipped' ? 'Skipped' : 'Not discussed',
    timeSpentMs: t.time_spent_ms,
    extensions: t.extensions,
  })
  const discussed = list
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
    .map((t, i) => ({ rank: i + 1, ...toRow(t) }))
  const rest = list
    .filter((t) => t.status !== 'discussed')
    .sort(
      (a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.sort_order - b.sort_order,
    )
    .map((t, i) => ({ rank: discussed.length + i + 1, ...toRow(t) }))
  const topicText = new Map(data.topics.map((t) => [t.id, t.text]))
  const end = state.ended_at ? Date.parse(state.ended_at) : now.getTime()
  return {
    title: state.name || 'Lean Coffee',
    date: state.started_at ? new Date(state.started_at) : now,
    people: data.participants.length,
    minutes: state.started_at
      ? Math.max(0, Math.round((end - Date.parse(state.started_at)) / 60_000))
      : 0,
    discussed,
    notDiscussed: rest,
    all: [...discussed, ...rest],
    actions: data.actions
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({
        text: a.text,
        owner: a.owner_name ?? '',
        topic: a.topic_id ? (topicText.get(a.topic_id) ?? '') : '',
        done: a.done,
      })),
    takeaways: data.takeaways
      .filter((t) => !t.passed && t.text)
      .map((t) => ({ name: t.author_name, text: t.text ?? '' })),
  }
}

export function mss(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
