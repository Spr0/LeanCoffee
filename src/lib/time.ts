/**
 * Server-authoritative clock. The database stores when a timer ends; clients compute the
 * countdown locally from a measured offset to the server clock, so nothing is written per second.
 */

/** Offset to add to Date.now() to get server time, measured from one round trip. */
export function measureOffset(
  serverTimeMs: number,
  sentAtMs: number,
  receivedAtMs: number,
): number {
  const midpoint = sentAtMs + (receivedAtMs - sentAtMs) / 2
  return serverTimeMs - midpoint
}

export interface TimerFields {
  phase_ends_at: string | null
  paused_remaining_ms: number | null
}

/** Milliseconds left (never negative), or null when no timer is set. */
export function remainingMs(timer: TimerFields, nowMs: number, offsetMs: number): number | null {
  if (timer.paused_remaining_ms !== null) return timer.paused_remaining_ms
  if (timer.phase_ends_at === null) return null
  return Math.max(0, Date.parse(timer.phase_ends_at) - (nowMs + offsetMs))
}

/** m:ss, rounding up so "0:00" only shows once time has really run out. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** True when someone was seen recently enough to count as connected. */
export function isPresent(
  lastSeenAt: string,
  nowMs: number,
  offsetMs: number,
  windowMs = 45_000,
): boolean {
  return nowMs + offsetMs - Date.parse(lastSeenAt) < windowMs
}
