import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { download } from '../../lib/export/download'
import type { Action, BoardState, Takeaway, Topic } from '../../lib/types'
import { makeCtx, makeTopic } from './testBoard'
import WrapUp from './WrapUp'

// The files are built and saved by the export module; here the call is watched, not run.
vi.mock('../../lib/export/download', () => ({ download: vi.fn(async () => {}) }))
afterEach(() => vi.clearAllMocks())

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function topics(): Topic[] {
  return [
    { ...makeTopic('t1', 'Onboarding', 'discussed', 1), time_spent_ms: 420_000 },
    { ...makeTopic('t2', 'AI tools', 'discussed', 2), time_spent_ms: 300_000, extensions: 1 },
    makeTopic('t3', 'Scope creep', 'open', 3),
    makeTopic('t4', 'Decision log', 'skipped', 4),
  ]
}

const action = (id: string, topic: string | null, text: string, done = false): Action => ({
  id,
  board_id: 'b1',
  topic_id: topic,
  text,
  owner_name: 'Maya',
  created_by: 'u2',
  done,
  created_at: `2026-10-25T10:0${id.slice(1)}:00Z`,
})

const ACTIONS = [
  action('a1', 't1', 'Draft the checklist', true),
  action('a2', 't4', 'Ask legal where decisions live'),
  action('a3', null, 'Book the next session'),
]
const TAKEAWAYS: Takeaway[] = [
  { id: 'k1', board_id: 'b1', user_id: 'u1', author_name: 'Fran', text: null, passed: true },
]

function setup(userId = 'u1', over: Partial<BoardState> = {}) {
  const act = vi.fn(async (fn: string, args?: Record<string, unknown>) => !!fn && !!args)
  const ctx = makeCtx(userId, topics(), act, {
    phase: 'wrapup',
    started_at: minutesAgo(70),
    phase_ends_at: new Date(Date.now() + 240_000).toISOString(),
    ...over,
  })
  ctx.board.data.actions = ACTIONS
  ctx.board.data.takeaways = TAKEAWAYS
  const view = render(<WrapUp ctx={ctx} remaining={ctx.state.phase_ends_at ? 240_000 : null} />)
  const rerender = (state: Partial<BoardState>) => {
    const s = { ...ctx.state, ...state }
    const fresh = {
      ...ctx,
      state: s,
      board: { ...ctx.board, data: { ...ctx.board.data, state: s } },
    }
    view.rerender(<WrapUp ctx={fresh} remaining={null} />)
  }
  return { act, ctx, rerender, user: userEvent.setup() }
}

const regions = () =>
  within(screen.getByRole('main'))
    .getAllByRole('region')
    .map((r) => r.getAttribute('aria-label'))
const said = () =>
  screen
    .getAllByRole('status')
    .map((s) => s.textContent)
    .join(' ')

describe('Wrap-up board', () => {
  it('is the final board: Not discussed, the wrap-up stage and Discussed', () => {
    setup('u2')
    expect(regions()).toEqual(['Not discussed', 'Wrap-up', 'Discussed'])
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Nice work. Capture what you are taking away.',
    ])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Not discussed 2',
      'Discussed 2',
    ])
    expect(screen.getByText('2 of 4 discussed')).toBeInTheDocument()
    expect(screen.getByText('70 of 75 min').parentElement).toHaveTextContent(
      '70 of 75 min · 3 actions',
    )
  })

  it('lists what was not discussed, skipped in words, with its actions', () => {
    setup('u2')
    const left = screen.getByRole('region', { name: 'Not discussed' })
    expect(
      within(left)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement?.parentElement === left.firstElementChild)
        .map((li) => li.textContent),
    ).toEqual([
      'Scope creepPat · 0 votes',
      'Decision logPat · 0 votes · skippedAsk legal where decisions live · Maya',
    ])
    expect(
      within(left).getByRole('checkbox', { name: 'Done: Ask legal where decisions live' }),
    ).toBeEnabled()
    expect(left).toHaveTextContent('These stay in the Word and Excel files')
  })

  it('shows every discussed topic with its actions, and new actions under Other actions', () => {
    setup('u2')
    const right = screen.getByRole('region', { name: 'Discussed' })
    expect(
      within(right).getByRole('list', { name: 'Actions from "Onboarding"' }),
    ).toHaveTextContent('Draft the checklist · Maya')
    expect(within(right).getByRole('checkbox', { name: 'Done: Draft the checklist' })).toBeChecked()
    expect(within(right).getByRole('list', { name: 'Other actions 1' })).toHaveTextContent(
      'Book the next session · Maya',
    )
  })

  it('shares a take-away or passes, and lists everyone so far', async () => {
    const { act, user } = setup('u2')
    expect(screen.getByText('0 of 2 shared')).toBeInTheDocument()
    expect(screen.getByText('Passed.').parentElement).toHaveTextContent('Fran Passed.')
    await user.type(screen.getByLabelText('Your take-away'), 'Checklists beat buddies')
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(act).toHaveBeenCalledWith('set_takeaway', {
      p_board: 'b1',
      p_text: 'Checklists beat buddies',
    })
    expect(screen.getByLabelText('Your take-away')).toHaveValue('')
    expect(said()).toContain('Your take-away is shared.')
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    expect(act).toHaveBeenLastCalledWith('set_takeaway', {
      p_board: 'b1',
      p_text: null,
      p_passed: true,
    })
  })

  it('adds a new action and says where it went', async () => {
    const { act, user } = setup('u2')
    await user.type(screen.getByLabelText('New action'), 'Send the notes')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    expect(act).toHaveBeenCalledWith('add_action', {
      p_board: 'b1',
      p_text: 'Send the notes',
      p_owner_name: null,
    })
    expect(said()).toContain('Action added under Other actions, in Discussed.')
  })

  it('gives the facilitator the clock buttons and End session; everyone the downloads', async () => {
    const { act, user } = setup('u1')
    const stage = screen.getByRole('region', { name: 'Wrap-up' })
    expect(within(stage).getByRole('timer')).toBeInTheDocument()
    expect(stage).toHaveTextContent('Wrap-up clock')
    for (const name of ['Pause', 'Remove 1 minute', 'Add 1 minute'])
      expect(within(stage).getByRole('button', { name })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'End session' }))
    expect(act).toHaveBeenCalledWith('end_session', { p_board: 'b1' })
    await user.click(screen.getByRole('button', { name: 'Download Word file' }))
    expect(download).toHaveBeenCalledWith(
      'docx',
      expect.objectContaining({ topics: expect.any(Array) }),
    )
  })

  it('gives participants the downloads but no clock buttons or End session', () => {
    setup('u2')
    expect(screen.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Excel file' })).toBeEnabled()
    for (const name of [/^Pause$/, /^End session$/, /^(Edit|Delete) "/])
      expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('shows no clock when wrap-up has none', () => {
    setup('u1', { phase_ends_at: null })
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument()
  })
})

describe('Ended board', () => {
  const ENDED = { phase: 'ended' as const, phase_ends_at: null, ended_at: minutesAgo(1) }

  it('is the same board, read-only, with the downloads', () => {
    setup('u1', ENDED)
    expect(regions()).toEqual(['Not discussed', 'Session ended', 'Discussed'])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This session has ended')
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('combobox')).toEqual([])
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    for (const box of boxes) expect(box).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^(Edit|Delete) "/ })).toBeNull()
    for (const name of [/^End session$/, /^Share$/, /^Pass$/, /^Add action$/, /^Pause$/])
      expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Excel file' })).toBeEnabled()
    expect(screen.getByText('Passed.')).toBeInTheDocument()
    // People and the facilitator's access controls stay reachable (decision D61).
    expect(screen.getByRole('button', { name: '2 people' })).toBeEnabled()
  })

  it('moves focus to the heading when End session takes its button away', async () => {
    const { rerender, user } = setup('u1')
    await user.click(screen.getByRole('button', { name: 'End session' }))
    rerender(ENDED)
    expect(screen.getByRole('heading', { level: 1, name: 'This session has ended' })).toHaveFocus()
  })
})
