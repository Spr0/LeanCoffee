import { useEffect, useRef, useState } from 'react'
import { formatClock } from '../../lib/time'
import { echoStatus } from './Dialog'

/**
 * Screen readers hear the timer only at 1:00, 0:30 and 0:00 (spec F15), politely, and also in an
 * open dialog, which hides the page behind it. Each crossing is a new line, so a mark crossed again
 * after time is added is said again; time added, or a new clock, clears the last line, so a
 * running clock never sits next to an old "Time's up".
 */
interface Announcement {
  text: string
  n: number
}

function useAnnouncement(remaining: number | null): Announcement {
  const [message, setMessage] = useState<Announcement>({ text: '', n: 0 })
  const last = useRef<number | null>(null)
  // The marks said since the clock last went up, so a small clock correction is not said twice.
  const said = useRef(new Set<number>())
  useEffect(() => {
    const prev = last.current
    last.current = remaining
    if (remaining === null || prev === null) return
    if (remaining > prev + 1000) {
      said.current.clear()
      setMessage((m) => (m.text ? { text: '', n: m.n + 1 } : m))
      return
    }
    for (const [at, text] of [
      [60_000, '1 minute left'],
      [30_000, '30 seconds left'],
      [0, "Time's up"],
    ] as const) {
      if (prev > at && remaining <= at && !said.current.has(at)) {
        said.current.add(at)
        setMessage((m) => ({ text, n: m.n + 1 }))
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
      <span key={message.n}>{message.text}</span>
    </p>
  )
}

function spoken(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m} minute${m === 1 ? '' : 's'} ${s % 60} seconds left`
}

/**
 * The clock's length, for the "of" label and the arc. Callers pass the set length, or the time
 * left once added time has taken it past that, which on its own would make the label count down
 * with the digits ("10:51 of 10:51"). The longest seen is kept until a new clock starts, that is
 * until the time left jumps back up to the length passed in.
 */
function useClockLength(remaining: number | null, totalMs: number): number {
  const [seen, setSeen] = useState({ remaining, length: totalMs })
  const fresh =
    remaining === null ||
    seen.remaining === null ||
    (remaining > seen.remaining + 1000 && remaining >= totalMs)
  const length = fresh ? totalMs : Math.max(seen.length, totalMs)
  if (seen.remaining !== remaining || seen.length !== length) setSeen({ remaining, length })
  return length
}

/**
 * Stage ring timer, built for Teams screen sharing: 72 px digits, a 5/100 stroke, turns orange
 * at 1:00 with a "1 min left" text label, and "Time's up" at zero. Never color alone. A clock of a
 * minute or less (a pitch, a tie-break) passes a shorter `urgentMs`, as 0:10 with "Under 10 s"
 * (the digits keep counting), so it does not look urgent from the start. The digits never cross
 * the stroke, whose inner edge is at 41.5% of the ring: four characters take 72 px from a 220 px
 * ring and 64 px below it, and five (ten minutes or more) take 64 px up to a 260 px ring. The
 * ring grows to fit the clock shown: at least 200 px, and 240 px for five characters, whatever
 * size is passed. In forced colors (Windows High Contrast) the ring takes system colors, the
 * remaining time as the strong arc, and the digits draw no backplate over the stroke.
 */
export function RingTimer({
  remaining,
  totalMs,
  paused,
  size: asked = 260,
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
  const length = useClockLength(remaining, totalMs)
  const fraction = Math.min(1, ms / length)
  const clock = formatClock(ms)
  const five = clock.length > 4
  const size = Math.max(asked, five ? 240 : 200)
  const big = size >= (five ? 260 : 220)
  const label = paused
    ? 'Paused'
    : done
      ? "Time's up"
      : urgent
        ? urgentMs >= 60_000
          ? `${Math.round(urgentMs / 60_000)} min left`
          : `Under ${Math.round(urgentMs / 1000)} s`
        : `of ${formatClock(length)}`
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
