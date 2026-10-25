import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../../lib/time'

/** Screen readers hear the timer only at 1:00, 0:30 and 0:00 (spec F15). */
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
      if (prev > at && remaining <= at) setMessage(text)
    }
  }, [remaining])
  return message
}

export function TimerAnnouncer({ remaining }: { remaining: number | null }) {
  const message = useAnnouncement(remaining)
  return (
    <p className="sr-only" aria-live="assertive">
      {message}
    </p>
  )
}

function spoken(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m} minute${m === 1 ? '' : 's'} ${s % 60} seconds left`
}

/** Sidebar clock: big digits, "of 5:00", and a heavy progress bar. */
export function ClockPanel({
  title,
  remaining,
  totalMs,
  paused,
  note,
}: {
  title: string
  remaining: number | null
  totalMs: number
  paused: boolean
  note?: string
}) {
  const fraction = remaining === null ? 0 : Math.min(1, remaining / totalMs)
  return (
    <div>
      <p className="text-[13px] font-bold tracking-[0.12em] text-muted uppercase">{title}</p>
      <div
        className="mt-2 flex items-baseline gap-2"
        role="timer"
        aria-label={remaining === null ? 'No timer' : spoken(remaining)}
      >
        <span className="text-[64px] leading-none font-extrabold text-teal tabular-nums">
          {remaining === null ? '–:––' : formatClock(remaining)}
        </span>
        <span className="text-[15px] text-muted">of {formatClock(totalMs)}</span>
        {paused && (
          <span className="ml-2 rounded-md bg-teal-soft px-2 py-1 text-[13px] font-bold text-teal">
            PAUSED
          </span>
        )}
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-teal" style={{ width: `${fraction * 100}%` }} />
      </div>
      {note && <p className="mt-2 text-[13px] text-muted">{note}</p>}
      <TimerAnnouncer remaining={remaining} />
    </div>
  )
}

/**
 * Stage ring timer, built for Teams screen sharing: 64 px+ digits, 10 px stroke, turns orange
 * at 1:00 with a "1 min left" text label, and "Time's up" at zero. Never color alone.
 */
export function RingTimer({
  remaining,
  totalMs,
  paused,
  size = 260,
}: {
  remaining: number | null
  totalMs: number
  paused: boolean
  size?: number
}) {
  const ms = remaining ?? 0
  const urgent = remaining !== null && ms <= 60_000
  const done = remaining === 0
  const r = 50 - 6
  const circumference = 2 * Math.PI * r
  const fraction = Math.min(1, ms / totalMs)
  const label = paused
    ? 'Paused'
    : done
      ? "Time's up"
      : urgent
        ? '1 min left'
        : `of ${formatClock(totalMs)}`
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={done ? "Time's up" : spoken(ms)}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle
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
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-[72px] leading-none font-extrabold tabular-nums ${urgent ? 'text-urgent' : 'text-ink'}`}
        >
          {formatClock(ms)}
        </span>
        <span
          className={`mt-2 text-[18px] font-extrabold ${urgent ? 'text-urgent' : 'text-muted'}`}
        >
          {label}
        </span>
      </div>
      <TimerAnnouncer remaining={remaining} />
    </div>
  )
}
