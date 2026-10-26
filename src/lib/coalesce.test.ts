import { coalesce } from './coalesce'

/** A load that waits until the test lets it finish. */
function loads() {
  const started: (() => void)[] = []
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        started.push(resolve)
      }),
  )
  return { load, finish: (i: number) => started[i]?.() }
}

describe('coalesce', () => {
  it('runs one load at a time, with one more queued behind it for a burst of calls', async () => {
    const { load, finish } = loads()
    const run = coalesce(load)
    const first = run()
    const burst = [run(), run(), run()]
    expect(load).toHaveBeenCalledTimes(1)
    expect(burst[1]).toBe(burst[0])
    finish(0)
    await first
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    finish(1)
    await Promise.all(burst)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh load once nothing is running', async () => {
    const { load, finish } = loads()
    const run = coalesce(load)
    const first = run()
    finish(0)
    await first
    const second = run()
    expect(load).toHaveBeenCalledTimes(2)
    finish(1)
    await second
  })

  it('still runs the queued load when the running one fails', async () => {
    const load = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue()
    const run = coalesce(load)
    const first = run()
    const queued = run()
    await expect(first).rejects.toThrow('offline')
    await queued
    expect(load).toHaveBeenCalledTimes(2)
  })
})
