import type { ReactNode } from 'react'
import { PeoplePanel } from '../../components/session/People'
import { Button } from '../../components/ui'
import type { BoardContext } from '../BoardView'

export interface PhaseProps {
  ctx: BoardContext
  remaining: number | null
}

/** Two-column session layout: main content and a sidebar ending in the people panel. */
export function Layout({
  ctx,
  main,
  side,
}: {
  ctx: BoardContext
  main: ReactNode
  side: ReactNode
}) {
  return (
    <div className="grid flex-1 lg:grid-cols-[1fr_436px]">
      <main className="min-w-0 px-4 py-7 sm:px-10">{main}</main>
      <aside
        className="flex flex-col gap-6 border-l border-line-soft bg-surface px-4 py-7 sm:px-7"
        aria-label="Session controls"
      >
        {side}
        <div className="mt-auto">
          <PeoplePanel ctx={ctx} />
        </div>
      </aside>
    </div>
  )
}

export function PageTitle({ title, intro }: { title: string; intro?: string }) {
  return (
    <div>
      <h1 className="text-[32px] leading-tight font-extrabold tracking-tight">{title}</h1>
      {intro && <p className="mt-2 max-w-[720px] text-[16px] text-muted">{intro}</p>}
    </div>
  )
}

/** Pause/resume and remove/add-time controls for whichever timer is running (spec F17). */
export function TimerButtons({ ctx, addSeconds = 60 }: { ctx: BoardContext; addSeconds?: number }) {
  const { state, act } = ctx
  const running = state.phase_ends_at !== null
  const paused = state.paused_remaining_ms !== null
  if (!running && !paused) return null
  const short = addSeconds >= 60 ? `${addSeconds / 60} min` : `${addSeconds} s`
  const spoken = addSeconds >= 60 ? `${addSeconds / 60} minute` : `${addSeconds} seconds`
  const adjust = (delta: number) =>
    act('timer_adjust', { p_board: state.board_id, p_delta_s: delta })
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button
        variant="secondary"
        onClick={() => act(paused ? 'timer_resume' : 'timer_pause', { p_board: state.board_id })}
      >
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button variant="secondary" onClick={() => adjust(-addSeconds)}>
        <span aria-hidden="true">-{short}</span>
        <span className="sr-only">Remove {spoken}</span>
      </Button>
      <Button variant="secondary" onClick={() => adjust(addSeconds)}>
        <span aria-hidden="true">+{short}</span>
        <span className="sr-only">Add {spoken}</span>
      </Button>
    </div>
  )
}

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[13px] font-bold tracking-[0.12em] text-muted uppercase">{children}</p>
      {right && <span className="text-[14px] font-bold">{right}</span>}
    </div>
  )
}

export function Check() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--teal)"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}
