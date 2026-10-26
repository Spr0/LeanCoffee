import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Action, BoardState, Topic } from '../../lib/types'
import { useMediaQuery } from '../../state/useMediaQuery'
import { ActionItem } from './BoardColumns'
import type { PhaseProps } from './common'

// The board frame of Discuss (decisions D75 to D79), for Vote, Wrap-up and the ended board.

/** The stage column: the focus of the board, under a 2 px pine edge. */
export const STAGE = '@container min-w-0 rounded-2xl border-2 border-teal bg-panel p-5'
// Chips on the stage. In dark mode --surface equals --panel, so they take --line to stand out.
export const CHIP = 'rounded-md bg-surface px-2.5 py-1 text-[14px] font-bold dark:bg-line'
/** A side column fills its grid cell beside the stage and scrolls on its own. */
export const FILL_LEFT = 'lg:absolute lg:inset-0 lg:overflow-y-auto'
export const FILL_RIGHT = 'xl:absolute xl:inset-0 xl:overflow-y-auto'

// Side columns sit on the page ground with a 2 px ring in dark mode, as in Discuss (D77).
const COLUMN = 'min-w-0 rounded-2xl bg-surface p-3 dark:bg-ground dark:ring-2 dark:ring-line'

/**
 * The board: a one-line toolbar, then the left column, the stage and the right column. Three
 * columns from 1280 px; from 1024 px the right column runs under the other two; under 1024 px they
 * stack with the stage first. The page order follows the screen at each width, so focus and
 * reading order match what is seen.
 */
export function BoardFrame({
  progress,
  tools,
  left,
  stage,
  right,
  note,
}: {
  progress: ReactNode
  tools: ReactNode
  left: ReactNode
  stage: ReactNode
  right: ReactNode
  note: LiveNote
}) {
  const wide = useMediaQuery('(min-width: 64rem)')
  const leftCell = (
    <div key="left" className="relative min-w-0">
      {left}
    </div>
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
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)] xl:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)_minmax(250px,1fr)]">
        {wide ? [leftCell, stage, rightCell] : [stage, leftCell, rightCell]}
      </div>
      <p role="status" className="sr-only">
        <span key={note.n}>{note.text}</span>
      </p>
    </main>
  )
}

/**
 * A side column. While it scrolls it takes a tab stop, so keyboard users can scroll it too.
 * `className` lets it fill its grid cell beside the stage.
 */
export function SideColumn({
  label,
  className,
  children,
}: {
  label: string
  className: string
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

/** A topic's actions under its card, each with its done box (disabled once the board ends). */
export function CardActions({
  ctx,
  topic,
  actions,
  readOnly = false,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  actions: Action[]
  readOnly?: boolean
}) {
  if (actions.length === 0) return null
  return (
    <ul
      aria-label={`Actions from "${topic.text}"`}
      className="mt-2 flex flex-col border-t-2 border-line-soft pt-1"
    >
      {actions.map((a) => (
        <li key={a.id}>
          {readOnly ? <EndedAction action={a} /> : <ActionItem ctx={ctx} action={a} compact />}
        </li>
      ))}
    </ul>
  )
}

/** An action on the ended board, as ActionItem shows it, with its done box disabled (D61). */
export function EndedAction({ action: a }: { action: Action }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-[14px]">
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-[var(--teal)]"
        checked={a.done}
        disabled
        aria-label={`Done: ${a.text}`}
      />
      <span className="min-w-0 flex-1 break-words">
        <span className={a.done ? 'line-through' : ''}>{a.text}</span>
        {a.owner_name && <b className="whitespace-nowrap"> · {a.owner_name}</b>}
      </span>
    </label>
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
      <div className="h-2.5 w-[180px] overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div
          className="h-full bg-teal"
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
  return [note, (text: string) => setNote((last) => ({ text, n: last.n + 1 }))]
}

/**
 * When `key` changes, the control that had focus in `area` has often gone with the old content
 * (the dot buttons at the reveal, "I'm done", Reveal results now). Focus then moves to `target`,
 * a heading with tabIndex -1, instead of the top of the page.
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
