import type { BoardState, ExtendRound, Topic, Vote } from './types'

/** Dots per topic in one round, from the votes this user is allowed to see. */
export function dotTotals(votes: Vote[], round: number): Map<string, number> {
  const totals = new Map<string, number>()
  for (const v of votes)
    if (v.round === round) totals.set(v.topic_id, (totals.get(v.topic_id) ?? 0) + v.dots)
  return totals
}

export function myDotsUsed(votes: Vote[], userId: string, round: number): number {
  return votes
    .filter((v) => v.user_id === userId && v.round === round)
    .reduce((n, v) => n + v.dots, 0)
}

export function myDots(votes: Vote[], userId: string, round: number, topicId: string): number {
  return (
    votes.find((v) => v.user_id === userId && v.round === round && v.topic_id === topicId)?.dots ??
    0
  )
}

/** Topics that can be voted on or discussed: not merged into another card. */
export function cards(topics: Topic[]): Topic[] {
  return topics.filter((t) => t.merged_into === null).sort((a, b) => a.sort_order - b.sort_order)
}

export function mergedInto(topics: Topic[], id: string): Topic[] {
  return topics.filter((t) => t.merged_into === id)
}

/** Open topics that share a main-round total with at least one other open topic, grouped. */
export function tieGroups(open: Topic[], totals: Map<string, number>): Topic[][] {
  const byTotal = new Map<number, Topic[]>()
  for (const t of open) {
    const n = totals.get(t.id) ?? 0
    byTotal.set(n, [...(byTotal.get(n) ?? []), t])
  }
  return [...byTotal.values()].filter((g) => g.length > 1)
}

/** Extend-vote rule (spec section 3): extend only if Keep going outnumbers Move on. */
export function extendOutcome(keep: number, moveOn: number): 'extend' | 'move_on' {
  return keep > moveOn ? 'extend' : 'move_on'
}

export function openRound(rounds: ExtendRound[], topicId: string | null): ExtendRound | undefined {
  return rounds.find((r) => r.topic_id === topicId && r.closed_at === null)
}

export function lastRound(rounds: ExtendRound[], topicId: string | null): ExtendRound | undefined {
  return rounds
    .filter((r) => r.topic_id === topicId)
    .sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0]
}

/** Minutes left in the planned session, measured from when Brainstorm started. */
export function sessionMinutesLeft(state: BoardState, nowMs: number): number | null {
  if (!state.started_at) return null
  const elapsed = (nowMs - Date.parse(state.started_at)) / 60_000
  return Math.max(0, state.planned_minutes - elapsed)
}

/** "Topics we can still fit": whole discussion boxes left after reserving wrap-up time. */
export function topicsThatFit(
  minutesLeft: number,
  discussSeconds: number,
  wrapupSeconds: number,
): number {
  const usable = minutesLeft - wrapupSeconds / 60
  return Math.max(0, Math.floor(usable / (discussSeconds / 60)))
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "1 vote", "3 votes". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Discuss toolbar: "Topic 3 of 7" while a topic is on stage, "2 of 7 discussed" between topics. */
export function discussProgress(topics: Topic[]): string {
  const all = cards(topics)
  const done = all.filter((t) => t.status === 'discussed').length
  return all.some((t) => t.status === 'discussing')
    ? `Topic ${done + 1} of ${all.length}`
    : `${done} of ${all.length} discussed`
}

/** "extended once", "extended twice", "extended 3 times"; empty when never extended. */
export function extendedText(times: number): string {
  if (times <= 0) return ''
  return `extended ${times === 1 ? 'once' : times === 2 ? 'twice' : `${times} times`}`
}

/** Topics longer than this take room from the stage ring. */
export const LONG_TOPIC = 60

/**
 * Stage ring size in px. A long topic or the extend vote shrinks the ring, never the type: the
 * topic stays at 44 px and the digits at 72 px for Teams screen sharing.
 */
export function stageRingSize(text: string, voting: boolean): number {
  return voting || text.length > LONG_TOPIC ? 200 : 220
}

/**
 * One polite announcement for what moved between two snapshots of the board: a topic starting,
 * finishing, skipped or deferred. A Move on vote is left out; its result panel says it.
 */
export function boardMoves(before: Topic[], after: Topic[], rounds: ExtendRound[]): string {
  const was = new Map(before.map((t) => [t.id, t.status]))
  const said: string[] = []
  for (const t of after) {
    if (was.get(t.id) !== 'discussing' || t.status === 'discussing') continue
    const round = lastRound(rounds, t.id)
    const byVote = round?.result === 'move_on' && round.keep_count !== null
    if (t.status === 'discussed' && !byVote)
      said.push(`"${t.text}" moved to Discussed after ${formatDuration(t.time_spent_ms)}.`)
    if (t.status === 'skipped') said.push(`"${t.text}" was skipped.`)
    if (t.status === 'open') said.push(`"${t.text}" moved back to the queue for later.`)
  }
  const started = after.find((t) => t.status === 'discussing' && was.get(t.id) !== 'discussing')
  if (started && was.has(started.id)) said.push(`Now discussing "${started.text}".`)
  return said.join(' ')
}
