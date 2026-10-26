import { callWhenDue } from './retry'

const server = vi.hoisted(() => ({ calls: [] as string[], refusals: [] as string[] }))

vi.mock('./supabase', () => {
  class AppError extends Error {
    readonly code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
  return {
    AppError,
    rpc: async (fn: string) => {
      server.calls.push(fn)
      const code = server.refusals.shift()
      if (code) throw new AppError(code)
    },
  }
})

describe('callWhenDue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    server.calls = []
    server.refusals = []
  })
  afterEach(() => vi.useRealTimers())

  const run = async () => {
    callWhenDue('reveal_votes', { p_board: 'b' }, 4, 1500)
    await vi.advanceTimersByTimeAsync(10_000)
  }

  it('tries again while the server says the clock has not run out yet', async () => {
    server.refusals = ['not_allowed', 'not_allowed']
    await run()
    expect(server.calls).toHaveLength(3)
  })

  it('stops at once when another browser already did it', async () => {
    server.refusals = ['voting_closed', 'voting_closed', 'voting_closed', 'voting_closed']
    await run()
    expect(server.calls).toHaveLength(1)
  })

  it('stops when the session has moved to another step', async () => {
    server.refusals = ['wrong_phase', 'wrong_phase']
    await run()
    expect(server.calls).toHaveLength(1)
  })

  it('tries again after a dropped connection, at most four times in all', async () => {
    server.refusals = ['network', 'busy', 'network', 'network', 'network']
    await run()
    expect(server.calls).toHaveLength(4)
  })
})
