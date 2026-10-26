/**
 * Runs `load` one at a time. A call while it runs queues one more run, and calls while that one
 * waits share it. A burst of change events (the vote reveal re-ranks every topic) then costs two
 * loads instead of one each, and the last load always starts after the last call, so nothing
 * written before a call is missed.
 */
export function coalesce(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null
  const start = () => {
    const run = load().finally(() => {
      running = null
    })
    running = run
    return run
  }
  const next = () => {
    queued = null
    return start()
  }
  return () => {
    if (queued) return queued
    if (!running) return start()
    queued = running.then(next, next)
    return queued
  }
}
