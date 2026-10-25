import { useCallback, useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { Button } from '../components/ui'
import { formatCode } from '../lib/code'
import { takeRecoveryTokenFromUrl } from '../lib/recovery'
import { navigate } from '../lib/router'
import { AppError, ensureSession, rpc } from '../lib/supabase'
import BoardView from './BoardView'
import Join, { type BoardInfo } from './Join'

type Step =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'join'; info: BoardInfo }
  | { kind: 'board'; boardId: string; userId: string; notice: string | null }

interface JoinResult {
  ok: boolean
  board_id?: string
  error?: string
}

/** Resolves /b/:code to the join screen or the live board. */
export default function BoardRoute({ code }: { code: string }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [recoveryToken] = useState(takeRecoveryTokenFromUrl)

  const enter = useCallback(
    async (boardId: string, userId: string) => {
      let notice: string | null = null
      if (recoveryToken) {
        try {
          const ok = await rpc<boolean>('reclaim_facilitator', {
            p_board: boardId,
            p_token: recoveryToken,
          })
          notice = ok
            ? 'You are the facilitator again.'
            : 'That recovery link did not work. The facilitator is unchanged.'
        } catch (e) {
          notice = e instanceof AppError ? e.message : 'That recovery link did not work.'
        }
      }
      setStep({ kind: 'board', boardId, userId, notice })
    },
    [recoveryToken],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const userId = await ensureSession()
        const info = await rpc<BoardInfo | null>('lookup_board', { p_code: code })
        if (cancelled) return
        if (!info) return setStep({ kind: 'missing' })
        if (info.already_member) {
          const res = await rpc<JoinResult>('join_board', {
            p_code: code,
            p_display_name: 'unused',
          })
          if (cancelled) return
          if (res.ok && res.board_id) await enter(res.board_id, userId)
          else setStep({ kind: 'error', message: new AppError(res.error ?? 'network').message })
          return
        }
        setStep({ kind: 'join', info })
      } catch (e) {
        if (!cancelled)
          setStep({
            kind: 'error',
            message: e instanceof AppError ? e.message : 'Could not open the board.',
          })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, enter])

  if (step.kind === 'board')
    return (
      <BoardView
        boardId={step.boardId}
        userId={step.userId}
        code={formatCode(code)}
        notice={step.notice}
      />
    )
  if (step.kind === 'join')
    return (
      <Join
        code={code}
        info={step.info}
        onJoined={async (boardId) => enter(boardId, await ensureSession())}
      />
    )

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main
        className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-4 px-4 py-10"
        aria-live="polite"
      >
        {step.kind === 'loading' && <p className="text-[17px] text-muted">Opening the board…</p>}
        {step.kind === 'missing' && (
          <>
            <h1 className="text-[32px] font-extrabold">Board not found</h1>
            <p className="text-[17px] text-muted">
              Check the code. Boards are deleted 7 days after the session ends.
            </p>
          </>
        )}
        {step.kind === 'error' && (
          <>
            <h1 className="text-[32px] font-extrabold">Something went wrong</h1>
            <p className="text-[17px] text-muted">{step.message}</p>
          </>
        )}
        {step.kind !== 'loading' && (
          <Button className="self-start" onClick={() => navigate('/')}>
            Go to the home page
          </Button>
        )}
      </main>
    </div>
  )
}
