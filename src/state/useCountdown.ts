import { useEffect, useRef } from 'react'
import { remainingMs, type TimerFields } from '../lib/time'
import { useNow } from './useNow'

/** Remaining time for the board's current timer, recomputed four times a second. */
export function useCountdown(timer: TimerFields, offsetMs: number): number | null {
  const now = useNow(250)
  return remainingMs(timer, now, offsetMs)
}

/**
 * Runs `fn` once when a running timer reaches zero (keyed by its end time, so a new timer
 * re-arms it). Used for the chime and for asking the server to close a phase or round.
 */
export function useAtZero(remaining: number | null, key: string | null, fn: () => void): void {
  const fired = useRef<string | null>(null)
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  useEffect(() => {
    if (remaining === 0 && key && fired.current !== key) {
      fired.current = key
      latest.current()
    }
  }, [remaining, key])
}
