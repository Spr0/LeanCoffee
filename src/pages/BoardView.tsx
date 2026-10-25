import { useCallback, useState } from 'react'
import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { navigate } from '../lib/router'
import { AppError, rpc } from '../lib/supabase'
import type { BoardState, Phase } from '../lib/types'
import { useBoard, type UseBoard } from '../state/useBoard'
import Lobby from './Lobby'
import SessionShell from './SessionShell'

export const PHASE_LABEL: Record<Phase, string> = {
  lobby: 'Lobby',
  brainstorm: 'Brainstorm',
  clarify: 'Clarify',
  vote: 'Vote',
  discuss: 'Discuss',
  wrapup: 'Wrap-up',
  ended: 'Ended',
}

export interface BoardContext {
  board: UseBoard
  state: BoardState
  userId: string
  code: string
  isFacilitator: boolean
  /** Runs an RPC and shows any failure in the shared error banner. Resolves false on failure. */
  act: (fn: string, args?: Record<string, unknown>) => Promise<boolean>
}

export default function BoardView({
  boardId,
  userId,
  code,
  notice,
}: {
  boardId: string
  userId: string
  code: string
  notice?: string | null
}) {
  const board = useBoard(boardId)
  const [error, setError] = useState<string | null>(notice ?? null)

  const act = useCallback(async (fn: string, args: Record<string, unknown> = {}) => {
    setError(null)
    try {
      await rpc(fn, args)
      return true
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Something went wrong. Try again.')
      return false
    }
  }, [])

  if (board.gone) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto flex max-w-[520px] flex-1 flex-col justify-center gap-4 px-4">
          <h1 className="text-[32px] font-extrabold">You are no longer on this board</h1>
          <p className="text-[17px] text-muted">
            The facilitator removed you, or the board was deleted.
          </p>
          <Button className="self-start" onClick={() => navigate('/')}>
            Go to the home page
          </Button>
        </main>
      </div>
    )
  }

  const state = board.data.state
  if (!board.loaded || !state) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <p className="p-10 text-[17px] text-muted" aria-live="polite">
          Loading the board…
        </p>
      </div>
    )
  }

  const isFacilitator = state.facilitator_user_id === userId
  const ctx: BoardContext = { board, state, userId, code, isFacilitator, act }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        context={PHASE_LABEL[state.phase]}
        right={
          isFacilitator && (
            <span className="rounded-md bg-teal-soft px-2.5 py-1 text-[13px] font-extrabold tracking-[0.08em] text-teal">
              FACILITATOR
            </span>
          )
        }
      />
      {board.connection === 'reconnecting' && (
        <div
          role="status"
          className="bg-urgent px-4 py-2 text-center text-[15px] font-bold text-ground"
        >
          Reconnecting… Changes you make now may not save.
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-center gap-4 bg-danger px-4 py-2 text-[15px] font-bold text-ground"
        >
          {error}
          <button type="button" className="underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {/* Screen readers hear each phase change; the main content swaps silently otherwise. */}
      <p className="sr-only" aria-live="polite">
        {`Now in ${PHASE_LABEL[state.phase]}`}
      </p>
      {state.phase === 'lobby' ? <Lobby ctx={ctx} /> : <SessionShell ctx={ctx} />}
    </div>
  )
}
