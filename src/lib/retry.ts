import { rpc } from './supabase'

/**
 * For calls made when a clock reaches zero. The server checks the deadline itself, so a browser
 * whose clock runs slightly fast may be refused at first; try a few more times, then give up
 * quietly (another browser, or the facilitator, will have done it).
 */
export function callWhenDue(
  fn: string,
  args: Record<string, unknown>,
  attempts = 4,
  delayMs = 1500,
): void {
  rpc(fn, args).catch(() => {
    if (attempts > 1) window.setTimeout(() => callWhenDue(fn, args, attempts - 1, delayMs), delayMs)
  })
}
