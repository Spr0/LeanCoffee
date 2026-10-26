import { useCallback, useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { echoError } from '../components/session/Dialog'
import { InviteButton } from '../components/session/Invite'
import { Button } from '../components/ui'
import { navigate } from '../lib/router'
import { AppError, rpc } from '../lib/supabase'
import type { BoardState, Phase } from '../lib/types'
import { useBoard, type UseBoard } from '../state/useBoard'
import { usePhaseFocus } from '../state/usePhaseFocus'
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
  /**
   * Runs an RPC and shows any failure in the shared error banner. Resolves false on failure.
   * Error codes in `quiet` are not shown: a press that lost a race to another tab, say.
   */
  act: (fn: string, args?: Record<string, unknown>, options?: ActOptions) => Promise<boolean>
}

export interface ActOptions {
  quiet?: readonly string[]
}

/** How long the board may take to load before it is opened again, and then before it says so. */
const LOAD_WAIT_MS = 10_000

/*
 * The board, opened again from scratch when it does not load: a failed read of the board state
 * (a 502 or 504 that the client does not retry) otherwise left "Loading the board…" up for good.
 * The first time this happens it reopens on its own; after that it says so, with Try again.
 */
export default function BoardView(props: {
  boardId: string
  userId: string
  code: string
  notice?: string | null
}) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return <Board key={attempt} {...props} attempt={attempt} retry={retry} />
}

/**
 * The tab's title names the phase and the session (WCAG 2.4.2), so a screen reader or a list of
 * tabs tells one board and one step from another. It goes back to the app's name on leaving.
 */
function usePageTitle(state: BoardState | null) {
  const phase = state?.phase
  const name = state?.name
  useEffect(() => {
    if (!phase) return
    document.title = [PHASE_LABEL[phase], name, 'Lean Coffee'].filter(Boolean).join(' · ')
  }, [phase, name])
  useEffect(
    () => () => {
      document.title = 'Lean Coffee'
    },
    [],
  )
}

/** The frame while the board loads, so the board fills in place instead of jumping in. */
function LoadingBoard({ slow, retry }: { slow: boolean; retry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div aria-hidden="true" className="h-[88px] shrink-0 border-b border-line-soft bg-surface" />
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-6">
        {slow ? (
          <div role="alert" className="flex flex-wrap items-center gap-4">
            <p className="text-[17px] font-bold">
              The board is not loading. Check your connection, then try again.
            </p>
            <Button onClick={retry}>Try again</Button>
          </div>
        ) : (
          <p className="text-[17px] text-muted" aria-live="polite">
            Loading the board…
          </p>
        )}
        <div
          aria-hidden="true"
          className="grid flex-1 gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)] xl:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)_minmax(250px,1fr)]"
        >
          <div className="min-h-[200px] animate-pulse rounded-2xl bg-surface dark:bg-line-soft" />
          <div className="min-h-[480px] animate-pulse rounded-2xl border-2 border-line-soft" />
          <div className="hidden min-h-[200px] animate-pulse rounded-2xl bg-surface xl:block dark:bg-line-soft" />
        </div>
      </main>
    </div>
  )
}

function Board({
  boardId,
  userId,
  code,
  notice,
  attempt,
  retry,
}: {
  boardId: string
  userId: string
  code: string
  notice?: string | null
  attempt: number
  retry: () => void
}) {
  const board = useBoard(boardId)
  const [error, setError] = useState<string | null>(notice ?? null)
  const [slow, setSlow] = useState(false)
  usePhaseFocus(board.data.state?.phase)
  usePageTitle(board.data.state)

  const act = useCallback(
    async (fn: string, args: Record<string, unknown> = {}, options: ActOptions = {}) => {
      setError(null)
      try {
        await rpc(fn, args)
        return true
      } catch (e) {
        // A removed person sees the removal screen at once (useBoard), so no banner first.
        const silent =
          e instanceof AppError && (e.code === 'not_member' || options.quiet?.includes(e.code))
        if (!silent)
          setError(e instanceof AppError ? e.message : 'Something went wrong. Try again.')
        return false
      }
    },
    [],
  )

  // An open dialog makes the banner inert, so the dialog shows the error too.
  useEffect(() => echoError(error), [error])

  const loading = !board.gone && (!board.loaded || !board.data.state)
  useEffect(() => {
    if (!loading) return
    const timer = window.setTimeout(() => (attempt === 0 ? retry() : setSlow(true)), LOAD_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [loading, attempt, retry])

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
  if (!board.loaded || !state) return <LoadingBoard slow={slow} retry={retry} />

  const isFacilitator = state.facilitator_user_id === userId
  const ctx: BoardContext = { board, state, userId, code, isFacilitator, act }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        context={
          state.phase === 'lobby' ? (
            PHASE_LABEL.lobby
          ) : (
            <>
              <span className="hidden max-w-[320px] min-w-0 truncate text-ink md:block">
                {state.name || 'Lean Coffee'}
              </span>
              <InviteButton ctx={ctx} />
            </>
          )
        }
        right={
          // On a phone the People dialog says who facilitates; the room code needs the room.
          isFacilitator && (
            <span className="hidden rounded-md bg-teal-soft px-2.5 py-1 text-[13px] font-extrabold tracking-[0.08em] text-teal sm:inline">
              FACILITATOR
            </span>
          )
        }
      />
      {/*
        The reconnecting notice and errors float over the phase stepper instead of pushing the
        board down the share. The status region is always there, so its text is read out.
      */}
      <div className="pointer-events-none fixed inset-x-0 top-[72px] z-40 flex flex-col items-center gap-2 px-4">
        <div role="status" className="flex flex-col items-center">
          {board.connection === 'reconnecting' && (
            <p className="pointer-events-auto rounded-xl bg-urgent px-4 py-2 text-center text-[15px] font-bold text-ground shadow-lg">
              Reconnecting… Changes you make now may not save.
            </p>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="pointer-events-auto flex max-w-[640px] items-center gap-3 rounded-xl bg-danger py-1 pr-1 pl-4 text-[15px] font-bold text-ground shadow-lg"
          >
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-lg px-3 underline"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      {/* Screen readers hear each phase change; the main content swaps silently otherwise. */}
      <p className="sr-only" aria-live="polite">
        {`Now in ${PHASE_LABEL[state.phase]}`}
      </p>
      {state.phase === 'lobby' ? <Lobby ctx={ctx} /> : <SessionShell ctx={ctx} />}
    </div>
  )
}
