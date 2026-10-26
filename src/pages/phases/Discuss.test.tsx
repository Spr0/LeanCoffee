import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { chime } from '../../lib/chime'
import { callWhenDue } from '../../lib/retry'
import Discuss from './Discuss'
import { makeCtx, makeTopic } from './testBoard'
import WrapUp from './WrapUp'
import type { BoardState, ExtendRound, Topic, Vote } from '../../lib/types'

// The clock-at-zero helpers call the server and play the chime; both are watched, not run.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))
vi.mock('../../lib/chime', async (load) => ({
  ...(await load<typeof import('../../lib/chime')>()),
  chime: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

const ends = () => new Date(Date.now() + 120_000).toISOString()
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
/** Text on the page, not counting the live line, which repeats some of it. */
const shown = (text: string) => screen.getByText(text, { ignore: '[role="status"] *' })

function board(status: 'discussing' | 'discussed' = 'discussing', extra: Topic[] = []): Topic[] {
  return [
    makeTopic('t1', 'On stage', status, 1),
    makeTopic('t2', 'Next up', 'open', 2),
    makeTopic('t3', 'Skipped topic', 'skipped', 3),
    ...extra,
  ]
}

function setup(
  userId: string,
  status: 'discussing' | 'discussed' = 'discussing',
  rounds: ExtendRound[] = [],
  over: Partial<BoardState> = {},
  topics = board(status),
) {
  const act = vi.fn(async () => true)
  const ctx = makeCtx(userId, topics, act, { phase_ends_at: ends(), ...over })
  ctx.board.data.extendRounds = rounds
  const view = render(<Discuss ctx={ctx} remaining={120_000} />)
  return { act, ctx, view, user: userEvent.setup() }
}

describe('Discuss board', () => {
  it('is one main landmark with the three columns in reading order and no sidebar', () => {
    setup('u2')
    const main = screen.getByRole('main')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(
      within(main)
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['To discuss', 'Discussing', 'Discussed'])
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'On stage',
    ])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'To discuss 1',
      'Discussed 0',
    ])
  })

  it('shows progress in the toolbar: topic, session time and what still fits', () => {
    setup('u2', 'discussing', [], { started_at: minutesAgo(37.5) }, [
      ...board('discussing'),
      makeTopic('t4', 'Done earlier', 'discussed', 4),
    ])
    expect(screen.getByText('Topic 2 of 4')).toBeInTheDocument()
    // 37.5 minutes left, less 2 on the clock and 5 for wrap-up: 30.5 minutes, six 5-minute topics.
    expect(screen.getByText('38 of 75 min').parentElement).toHaveTextContent(
      '38 of 75 min · about 6 more topics fit',
    )
  })

  it('counts what is discussed between topics', () => {
    setup('u2', 'discussed')
    expect(screen.getByText('1 of 3 discussed')).toBeInTheDocument()
  })

  it('shows the wrap-up reminder in the toolbar in the last 5 minutes, and says it once', () => {
    const { ctx, view } = setup('u1', 'discussing', [], { started_at: minutesAgo(71.5) })
    const reminder = shown('About 4 min left. Time to wrap up.')
    // In the toolbar, beside the session time, so the stage keeps its height on the share.
    expect(screen.getByText('72 of 75 min').closest('div')).toContainElement(reminder)
    expect(reminder.closest('[role="status"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Start wrap-up' })).toHaveLength(1)
    expect(screen.queryByText(/topics? fit/)).toBeNull()
    const live = () => document.querySelector('main > p[role="status"]')?.textContent
    expect(live()).toBe('About 4 min left. Time to wrap up.')
    // Said once: a later render does not repeat it.
    view.rerender(<Discuss ctx={{ ...ctx }} remaining={110_000} />)
    expect(live()).toBe('About 4 min left. Time to wrap up.')
  })

  it('says when the planned time is up, with the real minutes used', () => {
    setup('u2', 'discussing', [], { started_at: minutesAgo(80) })
    expect(shown('Past the planned 75 min. Time to wrap up.')).toBeInTheDocument()
    expect(screen.getByText('80 of 75 min')).toBeInTheDocument()
  })

  it('shows participants the wrap-up reminder without its button', () => {
    setup('u2', 'discussing', [], { started_at: minutesAgo(71) })
    expect(shown('About 4 min left. Time to wrap up.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start wrap-up' })).toBeNull()
  })

  it('chimes and asks the server for the extend vote when the clock reaches zero', () => {
    const ctx = makeCtx('u2', board(), vi.fn(), { phase_ends_at: ends() })
    render(<Discuss ctx={ctx} remaining={0} />)
    expect(chime).toHaveBeenCalledTimes(1)
    expect(callWhenDue).toHaveBeenCalledWith('open_extend_round', { p_board: 'b1' })
  })

  it('asks the server to resolve the extend vote when its 15 seconds are up', () => {
    const due = { ...round(0, 0, null), closed_at: null, keep_count: null }
    setup('u2', 'discussing', [{ ...due, closes_at: new Date(Date.now() - 1000).toISOString() }])
    expect(callWhenDue).toHaveBeenCalledWith('resolve_extend_round', { p_round: 'r1' })
    expect(callWhenDue).not.toHaveBeenCalledWith('open_extend_round', expect.anything())
  })

  it('stacks the stage first on a phone, so focus and reading order match the screen', () => {
    const matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    setup('u2')
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Discussing', 'To discuss', 'Discussed'])
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 64rem)')
    vi.unstubAllGlobals()
  })

  it('keeps the dots a discussed topic got before a re-vote', () => {
    const { ctx, view } = setup('u2', 'discussed', [], { base_round: 1 })
    const dots = (topic_id: string, round: number, n: number): Vote => ({
      id: `${topic_id}${round}`,
      board_id: 'b1',
      topic_id,
      user_id: 'u1',
      round,
      dots: n,
    })
    ctx.board.data.votes = [dots('t1', 0, 3), dots('t2', 0, 2), dots('t2', 1, 1)]
    view.rerender(<Discuss ctx={{ ...ctx }} remaining={null} />)
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent('3 votes')
    expect(screen.getByRole('region', { name: 'To discuss' })).toHaveTextContent('Pat · 1 vote')
  })

  it('gives the facilitator the stage controls, and participants none', () => {
    setup('u1')
    const stage = screen.getByRole('region', { name: 'Discussing' })
    for (const name of [
      'Pause',
      'Remove 1 minute',
      'Add 1 minute',
      'Call vote now',
      'Next topic',
      'Defer to later',
      'Skip',
      'Edit "On stage"',
    ])
      expect(within(stage).getByRole('button', { name })).toBeInTheDocument()
  })

  it('shows participants the same board without facilitator controls', () => {
    setup('u2')
    expect(screen.getByRole('heading', { level: 1, name: 'On stage' })).toBeInTheDocument()
    for (const name of [/^Pause$/, /^Call vote now$/, /^Next topic$/, /^Skip$/, /^Edit/, /^Move/])
      expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('region', { name: 'To discuss' })).toHaveTextContent('Skipped topic')
    expect(screen.getByLabelText('New action')).toBeInTheDocument()
  })

  it('takes a free-text action owner, and sends none when blank', async () => {
    const { act, user } = setup('u2')
    const owner = screen.getByRole('combobox', { name: 'Action owner' })
    expect(owner).toHaveAttribute('maxLength', '24')
    expect(owner).toHaveAttribute('placeholder', 'Owner (optional)')
    const options = [
      ...document.querySelectorAll(`#${CSS.escape(owner.getAttribute('list') ?? '')} option`),
    ]
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['Fran', 'Pat'])

    await user.type(screen.getByLabelText('New action'), 'Share the slides')
    await user.type(owner, '  Someone in finance ')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    expect(act).toHaveBeenCalledWith('add_action', {
      p_board: 'b1',
      p_text: 'Share the slides',
      p_owner_name: 'Someone in finance',
      p_topic: 't1',
    })
    expect(owner).toHaveValue('')

    await user.type(screen.getByLabelText('New action'), 'No owner')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    expect(act).toHaveBeenLastCalledWith('add_action', {
      p_board: 'b1',
      p_text: 'No owner',
      p_owner_name: null,
      p_topic: 't1',
    })
  })

  it('uses the shared timer buttons on stage', async () => {
    const { act, user } = setup('u1')
    expect(screen.getByText('+1 min')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(act).toHaveBeenCalledWith('timer_pause', { p_board: 'b1' })
  })

  it('sends each way off stage to the server', async () => {
    for (const [name, fn, args] of [
      ['Call vote now', 'open_extend_round', {}],
      ['Next topic', 'next_topic', { p_outcome: 'discussed' }],
      ['Defer to later', 'next_topic', { p_outcome: 'deferred' }],
      ['Skip', 'next_topic', { p_outcome: 'skipped' }],
    ] as const) {
      const { act, user, view } = setup('u1')
      await user.click(screen.getByRole('button', { name }))
      expect(act).toHaveBeenLastCalledWith(fn, { p_board: 'b1', ...args })
      view.unmount()
    }
  })

  it('takes one stage press at a time, until the stage changes', async () => {
    const { act, ctx, view, user } = setup('u1')
    const next = screen.getByRole('button', { name: 'Next topic' })
    await user.dblClick(next)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(act).toHaveBeenCalledTimes(1)
    // Still focusable, so a keyboard user keeps their place, but marked as not available.
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).not.toBeDisabled()
    // The stage changes: the next press works.
    const after = makeCtx('u1', board('discussed'), ctx.act, { phase_ends_at: null })
    view.rerender(<Discuss ctx={after} remaining={null} />)
    await user.click(screen.getByRole('button', { name: 'Start the 5:00 clock' }))
    expect(act).toHaveBeenLastCalledWith('start_discussion', { p_board: 'b1' })
    expect(act).toHaveBeenCalledTimes(2)
  })

  it('takes the press again when the server refuses it', async () => {
    const act = vi.fn(async () => false)
    const ctx = makeCtx('u1', board(), act, { phase_ends_at: ends() })
    render(<Discuss ctx={ctx} remaining={120_000} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Next topic' }))
    await user.click(screen.getByRole('button', { name: 'Next topic' }))
    expect(act).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Next topic' })).not.toHaveAttribute('aria-disabled')
  })

  it('keeps a half-typed action, and its focus, when the topic leaves the stage', async () => {
    const { ctx, view, user } = setup('u2')
    await user.type(screen.getByLabelText('New action'), 'Send the checklist to')
    const after = makeCtx('u2', board('discussed'), ctx.act, { phase_ends_at: null })
    view.rerender(<Discuss ctx={after} remaining={null} />)
    // Between topics the form is for the same topic, the last one.
    const field = screen.getByLabelText('New action')
    expect(field).toHaveValue('Send the checklist to')
    expect(field).toHaveFocus()
    await user.keyboard(' Maya')
    expect(field).toHaveValue('Send the checklist to Maya')
  })

  it('keeps a draft for the last topic under the next one when it starts at once', async () => {
    const { ctx, view, user } = setup('u2')
    await user.type(screen.getByRole('combobox', { name: 'Action owner' }), 'Ma')
    const after = makeCtx(
      'u2',
      [makeTopic('t1', 'On stage', 'discussed', 1), makeTopic('t2', 'Next up', 'discussing', 2)],
      ctx.act,
      { phase_ends_at: ends() },
    )
    view.rerender(<Discuss ctx={after} remaining={300_000} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toBeInTheDocument()
    const owners = screen.getAllByRole('combobox', { name: 'Action owner' })
    expect(owners.map((o) => (o as HTMLInputElement).value)).toEqual(['', 'Ma'])
    expect(owners[1]).toHaveFocus()
    expect(screen.getByText('Actions from the last topic')).toBeInTheDocument()
  })

  it('closes the stage editor when the facilitator role moves away', async () => {
    const { ctx, view, user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'Edit "On stage"' }))
    expect(screen.getByRole('textbox', { name: 'Edit topic' })).toBeInTheDocument()
    view.rerender(<Discuss ctx={{ ...ctx, isFacilitator: false }} remaining={120_000} />)
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'On stage' })).not.toHaveClass('sr-only')
  })

  it('lets the facilitator fix the topic on stage, keeping it the page heading', async () => {
    const { act, user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'Edit "On stage"' }))
    const input = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(input).toHaveFocus()
    expect(screen.getByRole('heading', { level: 1, name: 'On stage' })).toBeInTheDocument()
    await user.type(input, ', renamed{Enter}')
    expect(act).toHaveBeenCalledWith('edit_topic', { p_topic: 't1', p_text: 'On stage, renamed' })
    expect(screen.getByRole('button', { name: 'Edit "On stage"' })).toHaveFocus()
  })

  it('keeps the topic at 44 px and shrinks the ring for a long topic', () => {
    const long = 'A'.repeat(40) + ' ' + 'b'.repeat(40)
    setup('u2', 'discussing', [], {}, [makeTopic('t1', long, 'discussing', 1)])
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-[44px]')
    expect(screen.getByRole('timer')).toHaveStyle({ width: '200px' })
  })

  it('uses the 220 px ring for a short topic', () => {
    setup('u2')
    expect(screen.getByRole('timer')).toHaveStyle({ width: '220px' })
  })

  it('makes room in the ring for a clock of 10:00 or more', () => {
    const act = vi.fn(async () => true)
    const ctx = makeCtx('u2', board(), act, { phase_ends_at: ends() })
    ctx.state.settings = { ...ctx.state.settings, discuss_s: 600 }
    render(<Discuss ctx={ctx} remaining={600_000} />)
    expect(screen.getByRole('timer')).toHaveStyle({ width: '240px' })
    expect(screen.getByText('10:00')).toHaveClass('text-[64px]')
  })

  it('opens the people dialog from the toolbar', async () => {
    const { user } = setup('u1')
    await user.click(screen.getByRole('button', { name: '2 people' }))
    const dialog = screen.getByRole('dialog', { name: 'People' })
    const connected = within(dialog).getByRole('list', { name: 'People connected' })
    expect(
      within(connected)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['FFran', 'PPat'])
    expect(dialog).toHaveTextContent('Fran (you)')
    for (const name of ['Pass facilitator role', 'Manage people', 'End session', 'Sound on'])
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('gives participants the people dialog without the facilitator tools', async () => {
    const { user } = setup('u2')
    await user.click(screen.getByRole('button', { name: '2 people' }))
    const dialog = screen.getByRole('dialog', { name: 'People' })
    expect(within(dialog).queryByRole('button', { name: 'Pass facilitator role' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'End session' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: /^Sound/ })).toBeInTheDocument()
  })

  it('opens the downloads dialog from the toolbar, for everyone', async () => {
    const { user } = setup('u2')
    await user.click(screen.getByRole('button', { name: 'Downloads' }))
    const dialog = screen.getByRole('dialog', { name: 'Download the results' })
    expect(within(dialog).getByRole('button', { name: 'Download Word file' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Download Excel file' })).toBeEnabled()
    // The dialog's title names the files; there is no second heading inside.
    expect(within(dialog).getAllByRole('heading')).toHaveLength(1)
  })

  it('moves focus to the stage heading when the pressed button leaves with the topic', async () => {
    const { ctx, view, user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'Next topic' }))
    const after = makeCtx('u1', board('discussed'), ctx.act, { phase_ends_at: null })
    view.rerender(<Discuss ctx={after} remaining={null} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toHaveFocus()
  })

  it('announces a topic moving to Discussed and the next one starting', () => {
    const { ctx, view } = setup('u2')
    const done = { ...makeTopic('t1', 'On stage', 'discussed', 1), time_spent_ms: 300_000 }
    const after = makeCtx(
      'u2',
      [
        done,
        makeTopic('t2', 'Next up', 'discussing', 2),
        makeTopic('t3', 'Skipped topic', 'skipped', 3),
      ],
      ctx.act,
      { phase_ends_at: ends() },
    )
    view.rerender(<Discuss ctx={after} remaining={120_000} />)
    expect(screen.getByText(/moved to Discussed after/)).toHaveTextContent(
      '"On stage" moved to Discussed after 5:00. Now discussing "Next up".',
    )
    expect(screen.getByText(/moved to Discussed after/).closest('[role="status"]')).not.toBeNull()
  })
})

const round = (keep: number, moveOn: number, result: ExtendRound['result']): ExtendRound => ({
  id: 'r1',
  board_id: 'b1',
  topic_id: 't1',
  opened_at: new Date(Date.now() - 8000).toISOString(),
  closes_at: new Date(Date.now() + 7000).toISOString(),
  closed_at: new Date().toISOString(),
  votes_cast: keep + moveOn,
  keep_count: keep,
  neutral_count: 0,
  move_on_count: moveOn,
  result,
})

describe('Discuss extend vote', () => {
  it('stacks the vote inside the stage and shrinks the ring beside the topic', () => {
    setup('u2', 'discussing', [{ ...round(0, 0, null), closed_at: null, keep_count: null }])
    const stage = screen.getByRole('region', { name: 'Discussing' })
    const vote = within(stage).getByRole('region', { name: 'Extend vote' })
    expect(
      within(vote)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Keep going?', 'Neutral?', 'Move on?'])
    expect(within(stage).getByRole('timer')).toHaveStyle({ width: '200px' })
  })

  it('says when the group chose to keep going', () => {
    setup('u2', 'discussing', [round(2, 0, 'extend')])
    expect(
      screen.getByText('The group chose to keep going: the clock restarts at 3:00.'),
    ).toBeInTheDocument()
  })

  it('reads out a second extension too, though its words are the same', () => {
    const open = (id: string) => ({ ...round(0, 0, null), id, closed_at: null, keep_count: null })
    const kept = (id: string) => ({ ...round(3, 1, 'extend'), id })
    const { ctx, view } = setup('u2', 'discussing', [open('r1')])
    const show = (rounds: ExtendRound[]) => {
      const next = makeCtx('u2', board(), ctx.act, { phase_ends_at: ends() })
      next.board.data.extendRounds = rounds
      view.rerender(<Discuss ctx={next} remaining={120_000} />)
    }
    const said = 'The group chose to keep going on "On stage": the clock restarts at 3:00.'
    show([kept('r1')])
    const first = screen.getByText(said)
    show([kept('r1'), open('r2')])
    show([kept('r1'), kept('r2')])
    expect(screen.getByText(said)).not.toBe(first)
  })

  it('hides Call vote now while the vote is open', () => {
    setup('u1', 'discussing', [{ ...round(0, 0, null), closed_at: null, keep_count: null }])
    expect(screen.getByRole('button', { name: 'Next topic' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call vote now' })).toBeNull()
  })

  it('announces a Move on vote once, in the live line, not in the panels', () => {
    const open = { ...round(0, 0, null), closed_at: null, keep_count: null }
    const { ctx, view } = setup('u2', 'discussing', [open])
    const show = (topics: Topic[], rounds: ExtendRound[]) => {
      const next = makeCtx('u2', topics, ctx.act, { phase_ends_at: null })
      next.board.data.extendRounds = rounds
      view.rerender(<Discuss ctx={next} remaining={null} />)
    }
    // Topics reload before the closed vote, as realtime may deliver them.
    show(board('discussed'), [open])
    show(board('discussed'), [round(1, 4, 'move_on')])
    const live = screen
      .getAllByRole('status')
      .map((s) => s.textContent)
      .filter(Boolean)
    expect(live).toEqual([
      'The group chose to move on: "On stage" moved to Discussed (1 keep going, 0 neutral, 4 move on).',
    ])
    expect(screen.getByText('The group chose to move on.')).toBeVisible()
  })

  it('says when the facilitator extended against the vote', () => {
    setup('u2', 'discussing', [round(0, 2, 'extend')])
    expect(
      screen.getByText('The facilitator extended it: the clock restarts at 3:00.'),
    ).toBeInTheDocument()
  })

  it('clears the stage after Move on and lets the facilitator extend anyway', async () => {
    const { act, user } = setup('u1', 'discussed', [round(0, 2, 'move_on')])
    expect(screen.getByText('The group chose to move on.')).toBeInTheDocument()
    expect(screen.queryByText('DISCUSSING NOW')).toBeNull()
    // While the stage is clear, the next topic is the page's main heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Extend 3:00 anyway' }))
    expect(act).toHaveBeenCalledWith('extend_topic', { p_board: 'b1' })
  })

  it('offers the next topic, a re-vote and wrap-up between topics', async () => {
    for (const [name, fn, args] of [
      ['Start the 5:00 clock', 'start_discussion', {}],
      ['Re-vote remaining topics', 'revote', {}],
      ['Start wrap-up', 'start_phase', { p_phase: 'wrapup' }],
    ] as const) {
      const { act, user, view } = setup('u1', 'discussed')
      const stage = screen.getByRole('region', { name: 'Discussing' })
      expect(within(stage).getByText('UP NEXT')).toBeInTheDocument()
      await user.click(within(stage).getByRole('button', { name }))
      expect(act).toHaveBeenLastCalledWith(fn, { p_board: 'b1', ...args })
      // The last topic's actions are added here and listed under it in Discussed.
      expect(within(stage).getByText('Actions from the last topic')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('puts the start button beside UP NEXT, above a topic of any length', () => {
    setup('u1', 'discussed')
    const start = screen.getByRole('button', { name: 'Start the 5:00 clock' })
    const h1 = screen.getByRole('heading', { level: 1, name: 'Next up' })
    expect(start.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(h1).toHaveAttribute('dir', 'auto')
  })

  it('keeps focus on the vote button that closed the vote', async () => {
    const open = { ...round(0, 0, null), closed_at: null, keep_count: null }
    const { ctx, view, user } = setup('u2', 'discussing', [open])
    const keep = screen.getByRole('button', { name: /^Keep going/ })
    await user.click(keep)
    expect(ctx.act).toHaveBeenCalledWith('cast_extend_vote', { p_round: 'r1', p_choice: 'keep' })
    const next = makeCtx('u2', board(), ctx.act, { phase_ends_at: ends() })
    next.board.data.extendRounds = [round(2, 0, 'extend')]
    view.rerender(<Discuss ctx={next} remaining={180_000} />)
    const closed = screen.getByRole('button', { name: /^Keep going/ })
    expect(closed).toHaveFocus()
    expect(closed).toHaveAttribute('aria-disabled', 'true')
    // The hidden "?" is gone; the count is read with its word.
    expect(closed).toHaveAccessibleName(/^Keep going.*2 ?votes$/)
    await user.click(closed)
    expect(ctx.act).toHaveBeenCalledTimes(1)
  })

  it('does not show the vote that extended the topic when the extension reaches zero', () => {
    // The keep vote closed 4 s ago; the extended clock was cut to zero with Remove 1 minute.
    const kept = {
      ...round(2, 0, 'extend'),
      opened_at: new Date(Date.now() - 20_000).toISOString(),
      closed_at: new Date(Date.now() - 4000).toISOString(),
    }
    const ctx = makeCtx('u2', board(), vi.fn(), { phase_ends_at: new Date().toISOString() })
    ctx.board.data.extendRounds = [kept]
    render(<Discuss ctx={ctx} remaining={0} />)
    expect(screen.queryByRole('region', { name: 'Extend vote' })).toBeNull()
  })

  it('moves focus to the Move on result, so Extend anyway is the next stop', async () => {
    const open = { ...round(0, 0, null), closed_at: null, keep_count: null }
    const { ctx, view, user } = setup('u1', 'discussing', [open])
    await user.click(screen.getByRole('button', { name: /^Move on/ }))
    const next = makeCtx('u1', board('discussed'), ctx.act, { phase_ends_at: null })
    next.board.data.extendRounds = [round(0, 2, 'move_on')]
    view.rerender(<Discuss ctx={next} remaining={null} />)
    const result = screen.getByText('The group chose to move on.').closest('p')
    expect(result).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Extend 3:00 anyway' })).toHaveFocus()
  })

  it('shows the last board that agreed while the tables catch up', () => {
    // Between topics, Up next is "Next up". Start the clock: the topics reload first.
    const { ctx, view } = setup('u1', 'discussed')
    const mixed = makeCtx(
      'u1',
      [
        makeTopic('t1', 'On stage', 'discussed', 1),
        makeTopic('t2', 'Next up', 'discussing', 2),
        makeTopic('t3', 'Skipped topic', 'skipped', 3),
      ],
      ctx.act,
      { phase_ends_at: null, current_topic_id: null },
    )
    view.rerender(<Discuss ctx={mixed} remaining={null} />)
    // Not "UP NEXT Skipped topic" or an empty queue: still the board from before.
    const stage = screen.getByRole('region', { name: 'Discussing' })
    expect(within(stage).getByText('UP NEXT')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'To discuss' })).toHaveTextContent('Next up')
    // The board state arrives: the topic is on stage.
    const settled = makeCtx('u1', mixed.board.data.topics, ctx.act, {
      phase_ends_at: ends(),
      current_topic_id: 't2',
    })
    view.rerender(<Discuss ctx={settled} remaining={300_000} />)
    expect(within(stage).getByText('DISCUSSING NOW')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'To discuss' })).not.toHaveTextContent('Next up')
  })

  it('puts the stage editor in place of the 44 px heading', async () => {
    const { user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'Edit "On stage"' }))
    expect(screen.getByRole('heading', { level: 1, name: 'On stage' })).toHaveClass('sr-only')
    expect(screen.getByRole('textbox', { name: 'Edit topic' })).toHaveClass('text-[20px]')
  })

  it('tells participants who starts the next topic', () => {
    setup('u2', 'discussed')
    expect(screen.getByText('Waiting for the facilitator to start the next topic.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Start the/ })).toBeNull()
  })

  it('ends the queue with wrap-up', () => {
    setup('u1', 'discussed', [], {}, [makeTopic('t1', 'Only one', 'discussed', 1)])
    expect(
      screen.getByRole('heading', { level: 1, name: 'Every topic has been discussed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Start wrap-up to collect take-aways and download the results.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start wrap-up' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'To discuss' })).toHaveTextContent(
      'No topics waiting.',
    )
  })

  it('tells participants what happens once the queue is empty', () => {
    setup('u2', 'discussed', [], {}, [makeTopic('t1', 'Only one', 'discussed', 1)])
    expect(screen.getByText('Waiting for the facilitator to start wrap-up.')).toBeInTheDocument()
  })

  it('says the queue is empty when only skipped topics are left', () => {
    setup('u2', 'discussed', [], {}, [
      makeTopic('t1', 'Only one', 'discussed', 1),
      makeTopic('t2', 'Put aside', 'skipped', 2),
    ])
    expect(
      screen.getByRole('heading', { level: 1, name: 'No topics left in the queue' }),
    ).toBeInTheDocument()
  })

  it('points the facilitator to Bring back when only skipped topics are left', () => {
    setup('u1', 'discussed', [], {}, [
      makeTopic('t1', 'Only one', 'discussed', 1),
      makeTopic('t2', 'Put aside', 'skipped', 2),
    ])
    expect(
      screen.getByText('Bring back a skipped topic from To discuss, or start wrap-up.'),
    ).toBeInTheDocument()
  })
})

describe('WrapUp', () => {
  it('adds an action with an owner and shows the facilitator the timer buttons', async () => {
    const act = vi.fn(async () => true)
    const ctx = makeCtx('u1', [], act, { phase: 'wrapup', paused_remaining_ms: 90_000 })
    render(<WrapUp ctx={ctx} remaining={90_000} />)
    // In words, whichever clock Wrap-up uses.
    expect(screen.getByRole('timer')).toHaveTextContent(/paused/i)
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New action'), 'Book the next session')
    await user.type(screen.getByRole('combobox', { name: 'Action owner' }), 'Pat')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    expect(act).toHaveBeenCalledWith('add_action', {
      p_board: 'b1',
      p_text: 'Book the next session',
      p_owner_name: 'Pat',
    })
  })
})
