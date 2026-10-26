import type { BoardState, Topic, Vote } from '../../lib/types'

/** Dots per topic that the agenda may show. */
export interface VoteCounts {
  /** The main round of this vote (the base round; a re-vote starts a new one). */
  main: Map<string, number>
  /** Tie-break rounds since the main round. */
  tie: Map<string, number>
}

/**
 * Totals for the agenda, or null while the main round's counts are hidden. A round still being
 * voted on is left out: before its reveal the only rows returned are the user's own, which are not
 * totals. A tie-break round keeps the main round on show, so the agenda keeps its counts while the
 * tied topics are voted on again.
 */
export function voteCounts(
  votes: Vote[],
  state: Pick<BoardState, 'base_round' | 'vote_round' | 'votes_revealed_at'>,
): VoteCounts | null {
  const shown = (round: number) => round < state.vote_round || state.votes_revealed_at !== null
  if (!shown(state.base_round)) return null
  const main = new Map<string, number>()
  const tie = new Map<string, number>()
  for (const v of votes) {
    if (!shown(v.round) || v.round < state.base_round) continue
    const into = v.round === state.base_round ? main : tie
    into.set(v.topic_id, (into.get(v.topic_id) ?? 0) + v.dots)
  }
  return { main, tie }
}

/**
 * Open topics that stay tied: main and tie-break totals both match another topic's. Groups keep
 * the agenda order, and so do the topics in each.
 */
export function agendaTies(open: Topic[], counts: VoteCounts): Topic[][] {
  const key = (id: string) => `${counts.main.get(id) ?? 0}/${counts.tie.get(id) ?? 0}`
  const groups = new Map<string, Topic[]>()
  for (const t of open) groups.set(key(t.id), [...(groups.get(key(t.id)) ?? []), t])
  return [...groups.values()].filter((g) => g.length > 1)
}
