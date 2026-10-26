import { AppError, rpc } from './supabase'

/**
 * Refusals worth another try: the deadline has not passed by the server's clock yet
 * (`not_allowed`), or the call did not get through. Any other refusal means the step is already
 * done or gone (`voting_closed`, `wrong_phase`, `round_unavailable`), and asking again only fails
 * again.
 */
const TRY_AGAIN = new Set(['not_allowed', 'busy', 'conflict', 'network'])

/**
 * For calls made when a clock reaches zero. The server checks the deadline itself, so a browser
 * whose clock runs slightly fast may be refused at first; try a few more times, then give up
 * quietly (another browser, or the facilitator, will have done it). Stops at once when the server
 * says another browser already did it.
 */
export function callWhenDue(
  fn: string,
  args: Record<string, unknown>,
  attempts = 4,
  delayMs = 1500,
): void {
  rpc(fn, args).catch((e: unknown) => {
    const again = !(e instanceof AppError) || TRY_AGAIN.has(e.code)
    if (again && attempts > 1)
      window.setTimeout(() => callWhenDue(fn, args, attempts - 1, delayMs), delayMs)
  })
}
