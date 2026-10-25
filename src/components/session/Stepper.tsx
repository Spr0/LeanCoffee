import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../../lib/time'
import type { BoardState, Phase } from '../../lib/types'

const STEPS: { phase: Phase; label: string; hint: (s: BoardState) => string }[] = [
  {
    phase: 'brainstorm',
    label: 'Brainstorm',
    hint: (s) => formatClock(s.settings.brainstorm_s * 1000),
  },
  {
    phase: 'clarify',
    label: 'Clarify',
    hint: (s) => (s.settings.pitch_s ? `${s.settings.pitch_s} s per pitch` : 'No pitch timer'),
  },
  { phase: 'vote', label: 'Vote', hint: (s) => formatClock(s.settings.vote_s * 1000) },
  {
    phase: 'discuss',
    label: 'Discuss',
    hint: (s) => `${formatClock(s.settings.discuss_s * 1000)} per topic`,
  },
  { phase: 'wrapup', label: 'Wrap-up', hint: () => 'Take-aways and export' },
]
const ORDER: Phase[] = ['brainstorm', 'clarify', 'vote', 'discuss', 'wrapup', 'ended']

/** 88 px phase stepper shared by every session screen. */
export function PhaseStepper({ state, currentHint }: { state: BoardState; currentHint?: string }) {
  const current = ORDER.indexOf(state.phase)
  // On a phone the steps scroll sideways: the strip then takes a tab stop so keyboard users can
  // scroll it, and the current step is brought into view.
  const nav = useRef<HTMLElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const el = nav.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setScrolls(el.scrollWidth > el.clientWidth + 1))
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const el = nav.current
    const step = el?.querySelector<HTMLElement>('[aria-current="step"]')
    if (el && step) el.scrollLeft = step.offsetLeft - (el.clientWidth - step.offsetWidth) / 2
  }, [state.phase, scrolls])
  return (
    // Relative, so the hidden "(done)" labels scroll with the steps instead of widening a phone page.
    <nav
      ref={nav}
      aria-label="Session progress"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region needs a tab stop
      tabIndex={scrolls ? 0 : undefined}
      className="relative shrink-0 overflow-x-auto border-b border-line-soft bg-surface"
    >
      <ol className="flex h-[88px] min-w-max items-center gap-3 px-4 sm:px-10">
        {STEPS.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li
              key={step.phase}
              className="flex flex-1 items-center gap-3"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={`flex size-[34px] shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-bold ${
                  active
                    ? 'border-teal bg-teal text-on-teal'
                    : done
                      ? 'border-teal-soft bg-teal-soft text-teal'
                      : 'border-line-strong text-muted'
                }`}
              >
                {done ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    aria-hidden="true"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className="whitespace-nowrap">
                <span className="block text-[15px] font-bold">
                  {step.label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
                <span
                  className={`block text-[13px] ${active ? 'font-bold text-teal' : 'text-muted'}`}
                >
                  {active && currentHint ? currentHint : step.hint(state)}
                </span>
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`mx-2 h-0.5 min-w-8 flex-1 ${done ? 'bg-teal' : 'bg-line'}`}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
