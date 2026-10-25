import { formatClock, isPresent, measureOffset, remainingMs } from './time'

describe('measureOffset', () => {
  it('uses the round-trip midpoint', () => {
    expect(measureOffset(10_500, 10_000, 10_200)).toBe(400)
  })
  it.each([
    ['client 5 s behind', 5_000],
    ['client 5 s ahead', -5_000],
    ['client 60 s behind', 60_000],
  ])('recovers the skew when the %s', (_, skew) => {
    const sent = 1_000_000
    const received = sent + 300
    const server = sent + 150 + skew
    expect(measureOffset(server, sent, received)).toBe(skew)
  })
})

describe('remainingMs', () => {
  const end = '2026-10-25T10:05:00.000Z'
  const endMs = Date.parse(end)

  it('counts down to the server end time', () => {
    expect(remainingMs({ phase_ends_at: end, paused_remaining_ms: null }, endMs - 90_000, 0)).toBe(
      90_000,
    )
  })
  it('corrects for clock skew so skewed clients agree', () => {
    const timer = { phase_ends_at: end, paused_remaining_ms: null }
    const trueNow = endMs - 60_000
    for (const skew of [-5_000, 5_000, 60_000]) {
      const clientNow = trueNow - skew
      expect(remainingMs(timer, clientNow, skew)).toBe(60_000)
    }
  })
  it('never goes negative', () => {
    expect(remainingMs({ phase_ends_at: end, paused_remaining_ms: null }, endMs + 5_000, 0)).toBe(0)
  })
  it('shows the frozen remainder while paused', () => {
    expect(remainingMs({ phase_ends_at: null, paused_remaining_ms: 42_000 }, 0, 0)).toBe(42_000)
  })
  it('is null with no timer', () => {
    expect(remainingMs({ phase_ends_at: null, paused_remaining_ms: null }, 0, 0)).toBeNull()
  })
  it('jumps straight to the right value after a backgrounded tab resumes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(endMs - 300_000)
    const timer = { phase_ends_at: end, paused_remaining_ms: null }
    expect(remainingMs(timer, Date.now(), 0)).toBe(300_000)
    vi.advanceTimersByTime(250_000)
    expect(remainingMs(timer, Date.now(), 0)).toBe(50_000)
    vi.useRealTimers()
  })
})

describe('formatClock', () => {
  it.each([
    [300_000, '5:00'],
    [90_000, '1:30'],
    [59_001, '1:00'],
    [999, '0:01'],
    [0, '0:00'],
  ])('%i ms shows %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text)
  })
})

describe('isPresent', () => {
  it('counts people seen in the last 45 seconds', () => {
    const now = Date.parse('2026-10-25T10:00:00Z')
    expect(isPresent('2026-10-25T09:59:30Z', now, 0)).toBe(true)
    expect(isPresent('2026-10-25T09:59:00Z', now, 0)).toBe(false)
  })
})
