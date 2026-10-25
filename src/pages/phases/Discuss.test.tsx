import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Discuss from './Discuss'
import { makeCtx, makeTopic } from './testBoard'
import WrapUp from './WrapUp'
import type { BoardState, ExtendRound, Topic } from '../../lib/types'

// The clock-at-zero helpers call the server; nothing here reaches zero.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))

const ends = () => new Date(Date.now() + 120_000).toISOString()
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

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

  it('shows the wrap-up reminder in the last 5 minutes', () => {
    setup('u1', 'discussing', [], { started_at: minutesAgo(71) })
    const reminder = screen.getByText('About 5 minutes left in the session. Time to wrap up.')
    expect(reminder.closest('[role="status"]')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Start wrap-up' })).toHaveLength(1)
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
    const { act, user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'Call vote now' }))
    expect(act).toHaveBeenLastCalledWith('open_extend_round', { p_board: 'b1' })
    for (const [name, outcome] of [
      ['Next topic', 'discussed'],
      ['Defer to later', 'deferred'],
      ['Skip', 'skipped'],
    ]) {
      await user.click(screen.getByRole('button', { name }))
      expect(act).toHaveBeenLastCalledWith('next_topic', { p_board: 'b1', p_outcome: outcome })
    }
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
    expect(screen.getByText(/moved to Discussed after/)).toHaveAttribute('role', 'status')
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
    expect(screen.getByText('The group chose to keep going: 3:00 added.')).toBeInTheDocument()
  })

  it('says when the facilitator extended against the vote', () => {
    setup('u2', 'discussing', [round(0, 2, 'extend')])
    expect(screen.getByText('The facilitator extended it: 3:00 added.')).toBeInTheDocument()
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
    const { act, user } = setup('u1', 'discussed')
    const stage = screen.getByRole('region', { name: 'Discussing' })
    expect(within(stage).getByText('UP NEXT')).toBeInTheDocument()
    await user.click(within(stage).getByRole('button', { name: 'Start the 5:00 clock' }))
    expect(act).toHaveBeenLastCalledWith('start_discussion', { p_board: 'b1' })
    await user.click(within(stage).getByRole('button', { name: 'Re-vote remaining topics' }))
    expect(act).toHaveBeenLastCalledWith('revote', { p_board: 'b1' })
    await user.click(within(stage).getByRole('button', { name: 'Start wrap-up' }))
    expect(act).toHaveBeenLastCalledWith('start_phase', { p_board: 'b1', p_phase: 'wrapup' })
    // The last topic's actions are added here and listed under it in Discussed.
    expect(within(stage).getByText('Actions from the last topic')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Start wrap-up' })).toBeInTheDocument()
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
})

describe('WrapUp', () => {
  it('adds an action with an owner and shows the facilitator the timer buttons', async () => {
    const act = vi.fn(async () => true)
    const ctx = makeCtx('u1', [], act, { phase: 'wrapup', paused_remaining_ms: 90_000 })
    render(<WrapUp ctx={ctx} remaining={90_000} />)
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
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
