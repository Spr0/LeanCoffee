import { formatClock } from './time'
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

/**
 * Dots per topic on the Discuss board. Open topics and the one on stage count the current round. A
 * re-vote covers open topics only, so discussed and skipped topics keep the latest earlier round
 * they got dots in.
 */
export function boardTotals(votes: Vote[], topics: Topic[], round: number): Map<string, number> {
  const totals = dotTotals(votes, round)
  for (const t of topics) {
    if ((t.status !== 'discussed' && t.status !== 'skipped') || totals.has(t.id)) continue
    const own = votes.filter((v) => v.topic_id === t.id && v.round < round)
    const last = Math.max(-1, ...own.map((v) => v.round))
    if (last >= 0) totals.set(t.id, dotTotals(own, last).get(t.id) ?? 0)
  }
  return totals
}

/** Longer topics float the stage ring beside the badges and their first lines, then run under it. */
export const LONG_TOPIC = 45

/**
 * Stage ring size in px. A long topic or the extend vote shrinks the ring, never the type: the
 * topic stays at 44 px and the digits at 72 px for Teams screen sharing. A clock of 10:00 or more
 * takes the 240 px ring, as its five characters need the room inside even at 64 px.
 */
export function stageRingSize(text: string, voting: boolean, longestMs: number): number {
  if (formatClock(longestMs).length > 4) return 240
  return voting || text.length > LONG_TOPIC ? 200 : 220
}

/** The board as one announcement compares it: topics and extend votes. */
export interface BoardMoment {
  topics: Topic[]
  rounds: ExtendRound[]
}

/**
 * One polite announcement for what changed between two snapshots of the board: an extend vote's
 * result, or a topic starting, finishing, skipped or deferred. Topics and votes reload separately,
 * so a topic that leaves the stage while its vote still looks open is said once the vote closes.
 */
export function boardMoves(before: BoardMoment, after: BoardMoment, extendMs: number): string {
  const was = new Map(before.topics.map((t) => [t.id, t.status]))
  const wasRound = new Map(before.rounds.map((r) => [r.id, r]))
  const topics = new Map(after.topics.map((t) => [t.id, t]))
  const said: string[] = []
  const left = (t: Topic) =>
    t.status === 'discussed'
      ? `"${t.text}" moved to Discussed after ${formatDuration(t.time_spent_ms)}.`
      : t.status === 'skipped'
        ? `"${t.text}" was skipped.`
        : t.status === 'open'
          ? `"${t.text}" moved back to the queue for later.`
          : ''
  for (const r of after.rounds) {
    const old = wasRound.get(r.id)
    if (!r.closed_at || (old?.closed_at && old.result === r.result)) continue
    const t = topics.get(r.topic_id)
    const text = t ? `"${t.text}"` : 'the topic'
    if (r.keep_count === null) {
      // Closed by Next topic, Skip or Defer to later: the topic's move is the news.
      if (t && t.status !== 'discussing' && was.get(t.id) !== 'discussing') said.push(left(t))
    } else if (r.result === 'move_on') {
      said.push(
        `The group chose to move on: ${text} moved to Discussed (${r.keep_count} keep going, ${r.neutral_count} neutral, ${r.move_on_count} move on).`,
      )
    } else {
      const added = `${formatClock(extendMs)} added`
      said.push(
        extendOutcome(r.keep_count, r.move_on_count ?? 0) === 'extend'
          ? `The group chose to keep going on ${text}: ${added}.`
          : `The facilitator extended ${text}: ${added}.`,
      )
    }
  }
  for (const t of after.topics) {
    if (was.get(t.id) !== 'discussing' || t.status === 'discussing') continue
    const round = lastRound(after.rounds, t.id)
    // Its vote is still open in this snapshot, or the group's Move on above already says it.
    if (
      round &&
      (round.closed_at === null || (round.result === 'move_on' && round.keep_count !== null))
    )
      continue
    said.push(left(t))
  }
  const started = after.topics.find(
    (t) => t.status === 'discussing' && was.get(t.id) !== 'discussing',
  )
  if (started && was.has(started.id)) said.push(`Now discussing "${started.text}".`)
  return said.join(' ')
}
