import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Discuss from './Discuss'
import { makeCtx, makeTopic } from './testBoard'
import WrapUp from './WrapUp'
import type { ExtendRound } from '../../lib/types'

// The clock-at-zero helpers call the server; nothing here reaches zero.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))

const ends = () => new Date(Date.now() + 120_000).toISOString()

function setup(
  userId: string,
  status: 'discussing' | 'discussed' = 'discussing',
  rounds: ExtendRound[] = [],
) {
  const act = vi.fn(async () => true)
  const topics = [
    makeTopic('t1', 'On stage', status, 1),
    makeTopic('t2', 'Next up', 'open', 2),
    makeTopic('t3', 'Skipped topic', 'skipped', 3),
  ]
  const ctx = makeCtx(userId, topics, act, { phase_ends_at: ends() })
  ctx.board.data.extendRounds = rounds
  render(<Discuss ctx={ctx} remaining={120_000} />)
  return { act, user: userEvent.setup() }
}

describe('Discuss', () => {
  it('lists skipped topics in the sidebar; the facilitator can bring one back', async () => {
    const { act, user } = setup('u1')
    const side = screen.getByRole('complementary', { name: 'Session controls' })
    expect(side).toHaveTextContent('Skipped topic')
    await user.click(screen.getByRole('button', { name: 'Bring back "Skipped topic"' }))
    expect(act).toHaveBeenCalledWith('restore_topic', { p_topic: 't3' })
  })

  it('shows participants skipped topics without Bring back', () => {
    setup('u2')
    expect(screen.getByRole('complementary', { name: 'Session controls' })).toHaveTextContent(
      'Skipped topic',
    )
    expect(screen.queryByRole('button', { name: /Bring back/ })).toBeNull()
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

  it('counts characters in the parking lot', async () => {
    const { user } = setup('u2')
    const input = screen.getByLabelText('Add a topic to the end of the queue')
    expect(input).toHaveAccessibleDescription('0 of 160 characters')
    await user.type(input, 'Budget')
    expect(input).toHaveAccessibleDescription('6 of 160 characters')
  })

  it('uses the shared timer buttons on stage', async () => {
    const { act, user } = setup('u1')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByText('+1 min')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(act).toHaveBeenCalledWith('timer_pause', { p_board: 'b1' })
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

describe('Discuss extend vote results', () => {
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
    await user.click(screen.getByRole('button', { name: 'Extend 3:00 anyway' }))
    expect(act).toHaveBeenCalledWith('extend_topic', { p_board: 'b1' })
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
