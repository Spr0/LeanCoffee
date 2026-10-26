import { act as flush, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { callWhenDue } from '../../lib/retry'
import type { BoardState, Topic, Vote as Dot } from '../../lib/types'
import type { BoardContext } from '../BoardView'
import { makeCtx, makeTopic } from './testBoard'
import Vote from './Vote'

// The clock-at-zero reveal calls the server; it is watched, not run.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const ends = () => new Date(Date.now() + 60_000).toISOString()
const SETTINGS = makeCtx('u1', [], vi.fn()).state.settings
// Refusals that only mean the vote already moved on (a double press, another browser) are quiet.
const QUIET = { quiet: ['voting_closed', 'wrong_phase'] }

// Fran (u1) facilitates and Pat (u2) takes part; Sam, who has left, wrote all but Fran's topic.
const sam = (t: Topic): Topic => ({ ...t, author_user_id: 'u3', author_name: 'Sam' })
function topics(): Topic[] {
  return [
    sam(makeTopic('t1', 'Onboarding', 'open', 1)),
    sam(makeTopic('t2', 'Async updates', 'open', 2)),
    sam(makeTopic('t3', 'AI tools', 'open', 3)),
    { ...makeTopic('t4', 'Fran wrote this', 'open', 4), author_user_id: 'u1', author_name: 'Fran' },
  ]
}

const dot = (topic_id: string, user_id: string, dots: number, round = 0): Dot => ({
  id: `${topic_id}-${user_id}-${round}`,
  board_id: 'b1',
  topic_id,
  user_id,
  round,
  dots,
})

// Revealed: Onboarding 3, then Async updates and AI tools tied at 2, then Fran's topic at 0.
const RESULTS = [dot('t1', 'u1', 3), dot('t2', 'u1', 2), dot('t3', 'u2', 2)]
const REVEALED = { votes_revealed_at: new Date().toISOString(), phase_ends_at: null }

function setup(
  userId = 'u1',
  over: Partial<BoardState> = {},
  votes: Dot[] = [],
  list: Topic[] = topics(),
  prepare: (ctx: BoardContext) => void = () => {},
) {
  const act = vi.fn(async (fn: string, args?: Record<string, unknown>) => !!fn && !!args)
  const ctx = makeCtx(userId, list, act, {
    phase: 'vote',
    votes_revealed_at: null,
    phase_ends_at: ends(),
    ...over,
  })
  ctx.board.data.votes = votes
  prepare(ctx)
  const view = render(<Vote ctx={ctx} remaining={over.votes_revealed_at ? null : 60_000} />)
  // A later snapshot of the same board, as the realtime reload gives it.
  const rerender = (state: Partial<BoardState>, next: Dot[] = votes) => {
    const s = { ...ctx.state, ...state }
    const data = { ...ctx.board.data, state: s, votes: next }
    view.rerender(
      <Vote
        ctx={{ ...ctx, state: s, board: { ...ctx.board, data } }}
        remaining={s.votes_revealed_at ? null : 60_000}
      />,
    )
  }
  return { act, ctx, rerender, user: userEvent.setup() }
}

/** Marks someone as having pressed "I'm done". */
const finished = (userId: string) => (ctx: BoardContext) => {
  ctx.board.data.participants = ctx.board.data.participants.map((p) =>
    p.user_id === userId ? { ...p, finished_voting: true } : p,
  )
}

/** cast_dots answers only when `save` is called, as on a slow connection. */
function slowDots(act: ReturnType<typeof setup>['act']) {
  const answer: { save: (ok: boolean) => void } = { save: () => {} }
  act.mockImplementation((fn: string) =>
    fn === 'cast_dots'
      ? new Promise<boolean>((resolve) => (answer.save = resolve))
      : Promise.resolve(true),
  )
  return answer
}

const regions = () =>
  within(screen.getByRole('main'))
    .getAllByRole('region')
    .map((r) => r.getAttribute('aria-label'))
const column = () => screen.getByRole('region', { name: 'To discuss' })
const cards = () =>
  within(within(column()).getAllByRole('list')[0] as HTMLElement).getAllByRole('listitem')
const card = (text: string) => cards().find((li) => li.textContent?.includes(text)) as HTMLElement
const said = () =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent)
    .join(' ')

describe('Vote board while voting', () => {
  it('keeps the board: To discuss, the voting stage and Discussed, with one h1', () => {
    setup('u2')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(regions()).toEqual(['To discuss', 'Voting', 'Discussed'])
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Spend your 3 dots on what you most want to discuss',
    ])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'To discuss 4',
      'Discussed 0',
    ])
    expect(screen.getByText('Counts hidden until reveal')).toBeInTheDocument()
    expect(screen.getByText('4 topics on the ballot')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Downloads' })).toBeNull()
  })

  it('stacks the stage first on a phone', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    setup('u2')
    expect(regions()).toEqual(['Voting', 'To discuss', 'Discussed'])
  })

  it('puts dots on the cards in place; quick clicks add up before the server answers', async () => {
    const { act, user } = setup('u2')
    const add = screen.getByRole('button', { name: 'Add a dot to "Onboarding"' })
    await user.click(add)
    await user.click(add)
    expect(act).toHaveBeenNthCalledWith(1, 'cast_dots', { p_topic: 't1', p_dots: 1 })
    expect(act).toHaveBeenNthCalledWith(2, 'cast_dots', { p_topic: 't1', p_dots: 2 })
    expect(within(card('Onboarding')).getByRole('img', { name: '2 of your dots' })).toBeVisible()
    expect(screen.getByRole('img', { name: '2 of 3 dots used' })).toBeInTheDocument()
    expect(screen.getByText('1 left', { exact: true })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove a dot from "Onboarding"' }))
    expect(act).toHaveBeenLastCalledWith('cast_dots', { p_topic: 't1', p_dots: 1 })
  })

  it('stops at the budget and keeps focus on the button that reached it', async () => {
    const { act, user } = setup('u2', {}, [dot('t1', 'u2', 2)])
    const add = screen.getByRole('button', { name: 'Add a dot to "AI tools"' })
    await user.click(add)
    expect(screen.getByText('0 left', { exact: true })).toBeInTheDocument()
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveFocus()
    await user.click(add)
    expect(act).toHaveBeenCalledTimes(1)
  })

  it('shows your own topic without dot buttons when voting on it is off', () => {
    setup('u1')
    expect(card('Fran wrote this')).toHaveTextContent('YOUR TOPICVoting on your own topic is off.')
    expect(screen.queryByRole('button', { name: /dot (to|from) "Fran wrote this"/ })).toBeNull()
  })

  it('shows no counts before the reveal: only your dots and how many have finished', () => {
    const { ctx } = setup('u2', {}, [dot('t1', 'u2', 1)], topics(), finished('u1'))
    expect(column()).not.toHaveTextContent(/\d votes?/)
    const stage = screen.getByRole('region', { name: 'Voting' })
    expect(stage).toHaveTextContent('1 of 2 finished')
    // A count only: no name is on the stage, so nobody sees who has finished.
    for (const p of ctx.board.data.participants) expect(stage).not.toHaveTextContent(p.display_name)
  })

  it("waits for a dot still being sent before I'm done, so the last dot is not lost", async () => {
    const { act, user } = setup('u2')
    const answer = slowDots(act)
    await user.click(screen.getByRole('button', { name: 'Add a dot to "Onboarding"' }))
    await user.click(screen.getByRole('button', { name: "I'm done" }))
    // The last "I'm done" reveals the votes, and a dot arriving after that is refused.
    expect(act.mock.calls.map(([fn]) => fn)).toEqual(['cast_dots'])
    await flush(async () => answer.save(true))
    expect(act.mock.calls.map(([fn]) => fn)).toEqual(['cast_dots', 'finish_voting'])
    expect(act).toHaveBeenLastCalledWith('finish_voting', { p_board: 'b1', p_done: true }, QUIET)
  })

  it('waits for a dot still being sent before the facilitator reveals', async () => {
    const { act, user } = setup('u1')
    const answer = slowDots(act)
    await user.click(screen.getByRole('button', { name: 'Add a dot to "Onboarding"' }))
    await user.click(screen.getByRole('button', { name: 'Reveal results now' }))
    expect(act).not.toHaveBeenCalledWith('reveal_votes', expect.anything())
    await flush(async () => answer.save(true))
    expect(act).toHaveBeenLastCalledWith('reveal_votes', { p_board: 'b1' }, QUIET)
    expect(screen.getByRole('button', { name: 'Add 30 seconds' })).toBeInTheDocument()
  })

  it('sends one reveal for a double press, while the first is on its way', async () => {
    const { act, user } = setup('u1')
    act.mockImplementation(() => new Promise<boolean>(() => {}))
    await user.dblClick(screen.getByRole('button', { name: 'Reveal results now' }))
    await user.click(screen.getByRole('button', { name: 'Reveal results now' }))
    expect(act.mock.calls.filter(([fn]) => fn === 'reveal_votes')).toHaveLength(1)
  })

  it('marks used dots for forced colors, where the fill is dropped', () => {
    setup('u2', {}, [dot('t1', 'u2', 2)])
    const used = within(screen.getByRole('img', { name: '2 of 3 dots used' })).getAllByText(
      (_, el) => !!el?.className.includes('forced-colors:bg-[CanvasText]'),
    )
    expect(used).toHaveLength(2)
  })

  it("undoes I'm done", async () => {
    const { act, user } = setup('u2', {}, [], topics(), finished('u2'))
    const done = screen.getByRole('button', { name: "I'm done (undo)" })
    expect(done).toHaveAttribute('aria-pressed', 'true')
    await user.click(done)
    expect(act).toHaveBeenCalledWith('finish_voting', { p_board: 'b1', p_done: false }, QUIET)
  })

  it('asks the server to reveal when the clock reaches zero', () => {
    const ctx = makeCtx('u2', topics(), vi.fn(), {
      phase: 'vote',
      votes_revealed_at: null,
      phase_ends_at: new Date().toISOString(),
    })
    render(<Vote ctx={ctx} remaining={0} />)
    expect(callWhenDue).toHaveBeenCalledWith('reveal_votes', { p_board: 'b1' })
  })

  it('gives participants no facilitator controls', () => {
    setup('u2')
    for (const name of [/^Reveal results now$/, /^Pause$/, /^Add 30 seconds$/, /^Move "/])
      expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

describe('Vote board after the reveal', () => {
  it('ranks To discuss with totals and ties, and keeps an empty Discussed column', () => {
    setup('u2', REVEALED, RESULTS)
    expect(regions()).toEqual(['To discuss', 'Results', 'Discussed'])
    // As in Discuss's Up next, the next topic is the page heading, at 44 px for the share.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Onboarding')
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-[44px]')
    expect(cards().map((li) => li.textContent)).toEqual([
      'UP NEXT1OnboardingSam · 3 votes',
      '2Async updatesSam · 2 votesTIED',
      '3AI toolsSam · 2 votesTIED',
      '4Fran wrote thisFran · 0 votes',
    ])
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent(
      'Topics move here once discussed',
    )
    expect(screen.getByText('Agenda: 4 topics')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dot (to|from)/ })).toBeNull()
  })

  it('shows what is up next on the stage, and participants wait for the facilitator', () => {
    setup('u2', REVEALED, RESULTS)
    const stage = screen.getByRole('region', { name: 'Results' })
    expect(stage).toHaveTextContent(/^AGENDAUP NEXTOnboardingRaised by Sam · 3 votes/)
    expect(stage).toHaveTextContent('Waiting for the facilitator to start discussing.')
    expect(stage).toHaveTextContent('Topics marked TIED have the same dots.')
    for (const name of [/^Start discussing$/, /^Move "/, /^Break ties/, /^Quick vote/])
      expect(screen.queryByRole('button', { name })).toBeNull()
    // Downloads from the reveal on (spec F24), in the toolbar as in Discuss.
    expect(screen.getByRole('button', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('gives the facilitator arrows and Start discussing', async () => {
    const { act, user } = setup('u1', REVEALED, RESULTS)
    expect(screen.getByRole('region', { name: 'Results' })).toHaveTextContent(
      'One tie. Use the arrows to put tied topics in the order you want.',
    )
    // Not disabled at the ends, so focus stays on a button whose card reaches the top.
    expect(screen.getByRole('button', { name: 'Move "Onboarding" up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Move "Fran wrote this" down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Move "Onboarding" up' }))
    expect(act).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Move "AI tools" up' }))
    expect(act).toHaveBeenCalledWith('reorder_topics', {
      p_board: 'b1',
      p_ids: ['t1', 't3', 't2', 't4'],
    })
    // The arrow keeps focus and its name, so the live line says the new place.
    expect(await screen.findByText('"AI tools" moved up to 2 of 4.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move "Onboarding" down' }))
    expect(act).toHaveBeenLastCalledWith('reorder_topics', {
      p_board: 'b1',
      p_ids: ['t2', 't1', 't3', 't4'],
    })
    expect(await screen.findByText('"Onboarding" moved down to 2 of 4.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start discussing' }))
    expect(act).toHaveBeenLastCalledWith('start_phase', { p_board: 'b1', p_phase: 'discuss' })
  })

  it('lays out a right-to-left topic and name in their own direction', () => {
    setup('u2', REVEALED, RESULTS)
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('dir', 'auto')
    const stage = screen.getByRole('region', { name: 'Results' })
    // The name is isolated, so a right-to-left one cannot pull the vote count in front of it.
    expect(within(stage).getByText('Sam').tagName).toBe('BDI')
    for (const li of cards()) expect(li.querySelector('p[dir="auto"]')).not.toBeNull()
  })

  it('puts Start discussing under the next topic, before the ties', () => {
    setup('u1', REVEALED, RESULTS)
    const after = (a: HTMLElement, b: HTMLElement) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const start = screen.getByRole('button', { name: 'Start discussing' })
    expect(after(screen.getByRole('heading', { level: 1 }), start)).toBe(true)
    expect(after(start, screen.getByText('One tie.'))).toBe(true)
  })

  it('breaks ties at random when that is the setting', async () => {
    const { act, user } = setup(
      'u1',
      { ...REVEALED, settings: { ...SETTINGS, tie_break: 'random' } },
      RESULTS,
    )
    await user.click(screen.getByRole('button', { name: 'Break ties at random' }))
    expect(act).toHaveBeenCalledWith('break_ties_random', { p_board: 'b1' }, QUIET)
    expect(said()).toContain('Ties broken at random.')
    // The draw is settled on screen, and a second one is a deliberate choice.
    expect(screen.getByRole('region', { name: 'Results' })).toHaveTextContent(
      'Ties broken at random. Use the arrows to adjust, or draw again.',
    )
    await user.click(screen.getByRole('button', { name: 'Draw again' }))
    expect(act.mock.calls.filter(([fn]) => fn === 'break_ties_random')).toHaveLength(2)
  })

  it('says when the facilitator has moved topics out of dot order', () => {
    const list = topics()
    const moved = [1, 0, 2, 3].map((i, n) => ({ ...list[i], sort_order: n + 1 }) as Topic)
    setup('u2', REVEALED, RESULTS, moved)
    expect(screen.getByRole('region', { name: 'Results' })).toHaveTextContent(
      'To discuss is the agenda. The facilitator has moved topics out of dot order.',
    )
  })

  it('runs a one-dot vote among tied topics when that is the setting', async () => {
    const { act, user } = setup(
      'u1',
      { ...REVEALED, settings: { ...SETTINGS, tie_break: 'mini_vote' } },
      RESULTS,
    )
    await user.click(screen.getByRole('button', { name: 'Quick vote on 2 tied at 2' }))
    expect(act).toHaveBeenCalledWith(
      'start_tie_vote',
      { p_board: 'b1', p_topics: ['t2', 't3'] },
      QUIET,
    )
  })

  it('counts tie-break dots after the main total', () => {
    setup('u2', { ...REVEALED, vote_round: 1 }, [...RESULTS, dot('t3', 'u1', 1, 1)])
    expect(card('AI tools')).toHaveTextContent('Sam · 2 votes + 1 in the tie-break')
    // Main and tie-break totals now differ, so nothing is tied.
    expect(column()).not.toHaveTextContent('TIED')
  })

  it('names the tie-break dots on the stage as on the card', () => {
    const list = topics()
    const order = [2, 0, 1, 3].map((i, n) => ({ ...list[i], sort_order: n + 1 }) as Topic)
    const votes = [dot('t1', 'u1', 2), ...RESULTS.slice(1), dot('t3', 'u1', 1, 1)]
    setup('u2', { ...REVEALED, vote_round: 1 }, votes, order)
    expect(screen.getByRole('region', { name: 'Results' })).toHaveTextContent(
      'Raised by Sam · 2 votes + 1 in the tie-break',
    )
  })
})

describe('Vote board in a tie-break round', () => {
  const TIE = { vote_round: 1, tie_topic_ids: ['t2', 't3'] }

  it('keeps the agenda and puts the one dot on the tied cards only', () => {
    // Fran's own tie-break dot is on AI tools; it is not part of any total yet.
    setup('u1', TIE, [...RESULTS, dot('t3', 'u1', 1, 1)])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Tie-break: one dot for the topic you most want first',
    )
    expect(screen.getByText('Tie-break: 2 topics')).toBeInTheDocument()
    expect(card('Onboarding')).toHaveTextContent('Sam · 3 votes')
    expect(card('AI tools')).toHaveTextContent('Sam · 2 votesTIED')
    expect(within(card('AI tools')).getByRole('img', { name: '1 of your dots' })).toBeVisible()
    expect(screen.getByText('0 left', { exact: true })).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('button', { name: /^Add a dot/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Add a dot to "Async updates"', 'Add a dot to "AI tools"'])
    // A short clock turns urgent at 0:10, not from the start.
    expect(screen.getByRole('timer')).toHaveTextContent('1:00of 1:00')
  })

  it('keeps TIED on the other tie group while one group votes', () => {
    // Onboarding and Fran's topic tie at 0; Async updates and AI tools at 2 are being voted on.
    setup('u1', TIE, [dot('t2', 'u1', 2), dot('t3', 'u2', 2)])
    expect(card('Onboarding')).toHaveTextContent('TIED')
    expect(card('Fran wrote this')).toHaveTextContent('TIED')
    expect(card('AI tools')).toHaveTextContent('TIED')
  })
})

describe('Vote board in a re-vote', () => {
  it('keeps discussed and skipped topics with the dots that ranked them', () => {
    const list = [
      ...topics(),
      { ...makeTopic('t5', 'Discussed earlier', 'discussed', 5), time_spent_ms: 300_000 },
      makeTopic('t6', 'Skipped earlier', 'skipped', 6),
    ]
    setup(
      'u1',
      { vote_round: 1, base_round: 1 },
      [dot('t5', 'u1', 3), dot('t6', 'u1', 1), dot('t1', 'u1', 1, 1)],
      list,
    )
    expect(screen.getByRole('region', { name: 'Voting' })).toHaveTextContent('RE-VOTE')
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent(
      'Discussed earlier5:00 · 3 votes',
    )
    expect(screen.getByRole('list', { name: 'Skipped 1' })).toHaveTextContent(
      'Skipped earlierPat · 1 vote',
    )
    expect(screen.getByText('4 topics on the ballot')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /dot to "(Discussed|Skipped) earlier"/ }),
    ).toBeNull()
  })
})

describe('Vote board announcements and focus', () => {
  it('starts To discuss at its top when the votes are revealed', () => {
    const { rerender } = setup('u2')
    column().scrollTop = 300
    expect(column().scrollTop).toBe(300)
    rerender(REVEALED, RESULTS)
    expect(column().scrollTop).toBe(0)
  })

  it('says once that voting closed, and moves focus from "I\'m done" to the heading', async () => {
    const { rerender, user } = setup('u2')
    await user.click(screen.getByRole('button', { name: "I'm done" }))
    expect(said()).not.toContain('Voting closed')
    rerender(REVEALED, RESULTS)
    expect(said()).toContain('Voting closed. Here is the agenda.')
    expect(screen.getByRole('heading', { level: 1, name: 'Onboarding' })).toHaveFocus()
  })

  it('moves focus from a dot button to the To discuss heading when the dots go', async () => {
    const { rerender, user } = setup('u2')
    await user.click(screen.getByRole('button', { name: 'Add a dot to "AI tools"' }))
    rerender(REVEALED, RESULTS)
    expect(screen.getByRole('heading', { level: 2, name: 'To discuss 4' })).toHaveFocus()
  })

  it('says when a tie-break vote opens', () => {
    const { rerender } = setup('u2', REVEALED, RESULTS)
    rerender({
      votes_revealed_at: null,
      phase_ends_at: ends(),
      vote_round: 1,
      tie_topic_ids: ['t2', 't3'],
    })
    expect(said()).toContain('Tie-break vote on 2 tied topics: one dot for the one you want first.')
  })
})
