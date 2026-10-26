import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../../lib/time'
import { echoStatus } from './Dialog'

/**
 * Screen readers hear the timer only at 1:00, 0:30 and 0:00 (spec F15), politely, and also in an
 * open dialog, which hides the page behind it.
 */
function useAnnouncement(remaining: number | null): string {
  const [message, setMessage] = useState('')
  const last = useRef<number | null>(null)
  useEffect(() => {
    const prev = last.current
    last.current = remaining
    if (remaining === null || prev === null) return
    for (const [at, text] of [
      [60_000, '1 minute left'],
      [30_000, '30 seconds left'],
      [0, "Time's up"],
    ] as const) {
      if (prev > at && remaining <= at) {
        setMessage(text)
        echoStatus(text)
      }
    }
  }, [remaining])
  return message
}

export function TimerAnnouncer({ remaining }: { remaining: number | null }) {
  const message = useAnnouncement(remaining)
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  )
}

function spoken(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m} minute${m === 1 ? '' : 's'} ${s % 60} seconds left`
}

/**
 * Stage ring timer, built for Teams screen sharing: 72 px digits, a 5/100 stroke, turns orange
 * at 1:00 with a "1 min left" text label, and "Time's up" at zero. Never color alone. A clock of a
 * minute or less (a pitch, a tie-break) passes a shorter `urgentMs`, as 0:10 with "Under 10 s"
 * (the digits keep counting), so it does not look urgent from the start. The digits drop to 64 px
 * where 72 px would cross the stroke: rings under 200 px, and ten minutes or more (five
 * characters) in rings under 260 px.
 * Five characters at 64 px need a 240 px ring. In forced colors (Windows High Contrast) the ring
 * takes system colors, the remaining time as the strong arc, and the digits draw no backplate
 * over the stroke.
 */
export function RingTimer({
  remaining,
  totalMs,
  paused,
  size = 260,
  urgentMs = 60_000,
}: {
  remaining: number | null
  totalMs: number
  paused: boolean
  size?: number
  urgentMs?: number
}) {
  const ms = remaining ?? 0
  const urgent = remaining !== null && ms <= urgentMs
  const done = remaining === 0
  const r = 50 - 6
  const circumference = 2 * Math.PI * r
  const fraction = Math.min(1, ms / totalMs)
  const clock = formatClock(ms)
  const big = clock.length > 4 ? size >= 260 : size >= 200
  const label = paused
    ? 'Paused'
    : done
      ? "Time's up"
      : urgent
        ? urgentMs >= 60_000
          ? `${Math.round(urgentMs / 60_000)} min left`
          : `Under ${Math.round(urgentMs / 1000)} s`
        : `of ${formatClock(totalMs)}`
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={done ? "Time's up" : spoken(ms)}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth="5"
          className="forced-colors:stroke-[GrayText]"
        />
        <circle
          className="forced-colors:stroke-[Highlight]"
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={urgent ? 'var(--urgent)' : 'var(--teal)'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center forced-color-adjust-none forced-colors:text-[CanvasText]">
        <span
          className={`${big ? 'text-[72px]' : 'text-[64px]'} leading-none font-extrabold tabular-nums ${urgent ? 'text-urgent' : 'text-ink'} forced-colors:text-[CanvasText]`}
        >
          {clock}
        </span>
        <span
          className={`mt-2 text-[18px] font-extrabold ${urgent ? 'text-urgent' : 'text-muted'} forced-colors:text-[CanvasText]`}
        >
          {label}
        </span>
      </div>
      <TimerAnnouncer remaining={remaining} />
    </div>
  )
}
