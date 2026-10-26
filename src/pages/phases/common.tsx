import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { echoStatus } from '../../components/session/Dialog'
import { Button } from '../../components/ui'
import type { BoardState } from '../../lib/types'
import { useMediaQuery } from '../../state/useMediaQuery'
import type { BoardContext } from '../BoardView'

export interface PhaseProps {
  ctx: BoardContext
  remaining: number | null
}

/*
 * The board frame every phase after the Lobby shares (decisions D75 to D79 and D85): a one-line
 * toolbar, then the left column, the stage and the right column.
 */

/** The stage column: the focus of the board, under a 2 px pine edge. */
export const STAGE = '@container min-w-0 rounded-2xl border-2 border-teal bg-panel p-5'
/** A side column fills its grid cell beside the stage and scrolls on its own. */
export const FILL_LEFT = 'lg:absolute lg:inset-0 lg:overflow-y-auto'
export const FILL_RIGHT = 'xl:absolute xl:inset-0 xl:overflow-y-auto'
// Chips on the stage. In dark mode --surface equals --panel, so they take --line to stand out.
export const CHIP = 'rounded-md bg-surface px-2.5 py-1 text-[14px] font-bold dark:bg-line'
/** The stage's state chip, as DISCUSSING NOW. */
export const ACCENT_CHIP =
  'inline-block rounded-md bg-teal-soft px-2.5 py-1 text-[14px] font-extrabold tracking-[0.08em] text-teal'
/** A card's label above its text, as UP NEXT in To discuss. */
export const CARD_TAG = 'text-[13px] font-extrabold tracking-[0.1em] text-teal'

// Side columns sit on the page ground with a 2 px ring in dark mode, where --surface is --panel.
const COLUMN = 'min-w-0 rounded-2xl bg-surface p-3 dark:bg-ground dark:ring-2 dark:ring-line'

/**
 * The board: a one-line toolbar, an optional banner, then the left column, the stage and the
 * right column. Three columns from 1280 px; from 1024 px the right column runs under the other
 * two; under 1024 px they stack with the stage first. The page order follows the screen at each
 * width, so focus and reading order match what is seen. The live line is always on the page.
 */
export function BoardFrame({
  progress,
  tools,
  banner,
  left,
  stageLabel,
  stageRef,
  stage,
  right,
  note,
}: {
  progress: ReactNode
  tools: ReactNode
  banner?: ReactNode
  left: ReactNode
  stageLabel: string
  stageRef?: RefObject<HTMLElement | null>
  stage: ReactNode
  right: ReactNode
  note: LiveNote
}) {
  const wide = useMediaQuery('(min-width: 64rem)')
  // A toolbar dialog makes the page behind it inert, so it repeats the live line.
  useEffect(() => echoStatus(note.text), [note])
  const leftCell = (
    <div key="left" className="relative min-w-0">
      {left}
    </div>
  )
  const stageCell = (
    <section key="stage" ref={stageRef} aria-label={stageLabel} className={STAGE}>
      {stage}
    </section>
  )
  const rightCell = (
    <div key="right" className="relative min-w-0 lg:col-span-2 xl:col-span-1">
      {right}
    </div>
  )
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{progress}</div>
        <div className="flex flex-wrap items-center gap-2">{tools}</div>
      </div>
      {banner}
      {/* Beside the stage the side columns are as tall as its row and scroll on their own. */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)] xl:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)_minmax(250px,1fr)]">
        {wide ? [leftCell, stageCell, rightCell] : [stageCell, leftCell, rightCell]}
      </div>
      <p role="status" className="sr-only">
        <span key={note.n}>{note.text}</span>
      </p>
    </main>
  )
}

/**
 * A side column. `className` lets it fill its grid cell and scroll on its own beside the stage, so
 * reaching an old topic leaves the stage on the share. While it scrolls it takes a tab stop, so
 * keyboard users can scroll it too.
 */
export function SideColumn({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setScrolls(el.scrollHeight > el.clientHeight + 1))
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return (
    <section
      ref={ref}
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region needs a tab stop
      tabIndex={scrolls ? 0 : undefined}
      className={`${COLUMN} ${className}`}
    >
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/** Session time in the toolbar: minutes used of the planned length, with a bar. */
export function SessionTime({
  state,
  nowMs,
  extra,
}: {
  state: BoardState
  nowMs: number
  extra?: ReactNode
}) {
  if (!state.started_at) return null
  const used = Math.max(0, Math.round((nowMs - Date.parse(state.started_at)) / 60_000))
  return (
    <>
      <div
        className="h-2.5 w-[180px] overflow-hidden rounded-full bg-line forced-colors:border forced-colors:border-[CanvasText]"
        aria-hidden="true"
      >
        <div
          className="h-full bg-teal forced-colors:bg-[CanvasText]"
          style={{ width: `${Math.min(100, (used / state.planned_minutes) * 100)}%` }}
        />
      </div>
      <p className="text-[15px] text-muted">
        <b className="text-ink">
          {used} of {state.planned_minutes} min
        </b>
        {extra}
      </p>
    </>
  )
}

export interface LiveNote {
  text: string
  n: number
}

/** The board's one polite live line. Each message is a new node, so a repeat is read out too. */
export function useLiveNote(): [LiveNote, (text: string) => void] {
  const [note, setNote] = useState<LiveNote>({ text: '', n: 0 })
  const announce = useCallback((text: string) => setNote((last) => ({ text, n: last.n + 1 })), [])
  return [note, announce]
}

/**
 * When `key` changes, the control that had focus in `area` has often gone with the old content
 * (Next topic, Start pitches, "I'm done", Reveal results now). Focus then moves to `target`, a
 * heading with tabIndex -1, instead of the top of the page.
 */
export function useRefocus<A extends HTMLElement, T extends HTMLElement>(
  key: string,
): { area: RefObject<A | null>; target: RefObject<T | null> } {
  const area = useRef<A>(null)
  const target = useRef<T>(null)
  const inside = useRef(false)
  useEffect(() => {
    const track = (e: FocusEvent) => {
      inside.current = !!area.current?.contains(e.target as Node)
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [])
  useEffect(() => {
    const active = document.activeElement
    if (inside.current && (active === null || active === document.body)) target.current?.focus()
  }, [key])
  return { area, target }
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
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
      // currentColor follows forced colors (Windows High Contrast); a set stroke would not.
      className="text-teal"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}
