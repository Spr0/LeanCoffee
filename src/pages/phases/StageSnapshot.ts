import { useState } from 'react'
import { boardAgrees } from '../../lib/session'
import type { BoardState, ExtendRound, Topic } from '../../lib/types'
import type { BoardContext } from '../BoardView'

/** How long the stage waits for the tables to agree before it shows them as they are. */
export const SETTLE_MS = 3000

interface Snapshot {
  state: BoardState
  topics: Topic[]
  rounds: ExtendRound[]
}

/**
 * The board as the Discuss stage and its columns show it. The board state, the topics and the
 * extend votes reload separately, so after a press each browser can briefly hold a mix: the topic
 * on stage already in Discussed, the wrong Up next with its start button, or a Move on result that
 * arrives after Up next and pushes it down. While the tables disagree (`boardAgrees`), this keeps
 * the last board that agreed, for up to SETTLE_MS; after that it shows the tables as they are, so a
 * lost update can never freeze the stage. `nowMs` comes from the page's clock tick.
 */
export function useSettledBoard(
  ctx: BoardContext,
  nowMs: number,
): { ctx: BoardContext; held: boolean } {
  const { state } = ctx
  const { topics, extendRounds: rounds } = ctx.board.data
  const agrees = boardAgrees(state, topics, rounds)
  const [last, setLast] = useState<Snapshot>({ state, topics, rounds })
  const [since, setSince] = useState<number | null>(null)
  if (agrees) {
    if (last.state !== state || last.topics !== topics || last.rounds !== rounds)
      setLast({ state, topics, rounds })
    if (since !== null) setSince(null)
  } else if (since === null) setSince(nowMs)
  const held = !agrees && (since === null || nowMs - since < SETTLE_MS)
  if (!held) return { ctx, held }
  return {
    held,
    ctx: {
      ...ctx,
      state: last.state,
      board: {
        ...ctx.board,
        data: {
          ...ctx.board.data,
          state: last.state,
          topics: last.topics,
          extendRounds: last.rounds,
        },
      },
    },
  }
}
