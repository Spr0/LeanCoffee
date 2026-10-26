import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PeopleButton } from '../../components/session/People'
import { sessionMinutesLeft } from '../../lib/session'
import { useMediaQuery } from '../../state/useMediaQuery'
import { useNow } from '../../state/useNow'
import { DiscussedColumn } from './BoardColumns'
import type { PhaseProps } from './common'

/*
 * The board frame for Brainstorm and Clarify, the same frame as Discuss (D75, D77, D78): a one-line
 * toolbar, then To discuss on the left, the stage in the middle and Discussed on the right. The
 * pieces copy Discuss and BoardColumns, whose versions are private; they could move to common.tsx.
 */

// Side columns sit on the page ground with a 2 px ring in dark mode, where --surface is --panel.
const COLUMN = 'min-w-0 rounded-2xl bg-surface p-3 dark:bg-ground dark:ring-2 dark:ring-line'

/** The stage's state chip, as DISCUSSING NOW. */
export const ACCENT_CHIP =
  'inline-block rounded-md bg-teal-soft px-2.5 py-1 text-[14px] font-extrabold tracking-[0.08em] text-teal'

/** A card's label above its text, as UP NEXT in To discuss. */
export const CARD_TAG = 'text-[13px] font-extrabold tracking-[0.1em] text-teal'

const NO_VOTES = new Map<string, number>()

/** A side column; while it scrolls beside the stage it takes a tab stop, as in Discuss. */
export function Column({
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

export interface Note {
  text: string
  n: number
}

/** The live line. Each message is a new node, so a repeated message is read out too. */
export function useLiveLine(): [Note, (text: string) => void] {
  const [note, setNote] = useState<Note>({ text: '', n: 0 })
  const announce = useCallback((text: string) => setNote((last) => ({ text, n: last.n + 1 })), [])
  return [note, announce]
}

/**
 * A pressed stage button often leaves with the stage's old content. When `key` changes and focus
 * was in the stage but is now nowhere, it moves to the stage heading instead of the page top.
 */
export function useStageFocus(key: string) {
  const stage = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusInStage = useRef(false)
  useEffect(() => {
    const track = (e: FocusEvent) => {
      focusInStage.current = !!stage.current?.contains(e.target as Node)
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [])
  useEffect(() => {
    const active = document.activeElement
    if (focusInStage.current && (active === null || active === document.body))
      heading.current?.focus()
  }, [key])
  return { stage, heading }
}

/** The session's progress bar and minutes, as in the Discuss toolbar. */
function SessionTime({ ctx }: { ctx: PhaseProps['ctx'] }) {
  const { state, board } = ctx
  const now = useNow(1000)
  const minutesLeft = sessionMinutesLeft(state, now + board.offsetMs)
  if (minutesLeft === null) return null
  const elapsed = state.planned_minutes - minutesLeft
  return (
    <>
      <div className="h-2.5 w-[180px] overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div
          className="h-full bg-teal"
          style={{ width: `${Math.min(100, (elapsed / state.planned_minutes) * 100)}%` }}
        />
      </div>
      <p className="text-[15px] font-bold">
        {Math.round(elapsed)} of {state.planned_minutes} min
      </p>
    </>
  )
}

/**
 * The page: toolbar, the three columns and the live line. Focus and reading order follow the
 * screen: the left column, the stage, then Discussed from 1024 px, and the stage first on a phone.
 * Beside the stage the side columns are as tall as its row and scroll on their own.
 */
export function BoardFrame({
  ctx,
  progress,
  leftLabel,
  left,
  stageLabel,
  stageRef,
  stage,
  note,
  onNote,
}: {
  ctx: PhaseProps['ctx']
  progress: ReactNode
  leftLabel: string
  left: ReactNode
  stageLabel: string
  stageRef?: RefObject<HTMLElement | null>
  stage: ReactNode
  note: Note
  onNote: (text: string) => void
}) {
  const wide = useMediaQuery('(min-width: 64rem)')
  const leftColumn = (
    <div key="left" className="relative min-w-0">
      <Column label={leftLabel} className="lg:absolute lg:inset-0 lg:overflow-y-auto">
        {left}
      </Column>
    </div>
  )
  // Nothing is discussed yet; the column keeps the board's shape from the first phase on.
  const discussedColumn = (
    <div key="discussed" className="relative min-w-0 lg:col-span-2 xl:col-span-1">
      <DiscussedColumn
        ctx={ctx}
        totals={NO_VOTES}
        onNote={onNote}
        className="xl:absolute xl:inset-0 xl:overflow-y-auto"
      />
    </div>
  )
  const stageColumn = (
    <section
      key="stage"
      ref={stageRef}
      aria-label={stageLabel}
      className="@container min-w-0 rounded-2xl border-2 border-teal bg-panel p-5"
    >
      {stage}
    </section>
  )
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          {progress}
          <SessionTime ctx={ctx} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeopleButton ctx={ctx} />
        </div>
      </div>
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)] xl:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)_minmax(250px,1fr)]">
        {wide
          ? [leftColumn, stageColumn, discussedColumn]
          : [stageColumn, leftColumn, discussedColumn]}
      </div>
      <p role="status" className="sr-only">
        <span key={note.n}>{note.text}</span>
      </p>
    </main>
  )
}
