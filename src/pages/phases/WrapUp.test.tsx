import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { download } from '../../lib/export/download'
import type { Action, BoardState, Takeaway, Topic } from '../../lib/types'
import { makeCtx, makeTopic } from './testBoard'
import WrapUp from './WrapUp'

// The files are built and saved by the export module; here the call is watched, not run.
vi.mock('../../lib/export/download', () => ({
  download: vi.fn(async () => {}),
  previewName: (_data: unknown, kind: string) => `Lean Coffee 2026-10-26.${kind}`,
}))
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
    // The column's list is named by its heading.
    expect(screen.getByRole('list', { name: 'Not discussed 2' })).toBeInTheDocument()
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

  it('says a topic was partly discussed, or skipped after a while, as the files do', () => {
    const list = topics().map((t) =>
      t.id === 't3'
        ? { ...t, time_spent_ms: 7_000 }
        : t.id === 't4'
          ? { ...t, time_spent_ms: 5_000 }
          : t,
    )
    const ctx = makeCtx('u2', list, vi.fn(), { phase: 'wrapup' })
    render(<WrapUp ctx={ctx} remaining={null} />)
    const left = screen.getByRole('region', { name: 'Not discussed' })
    expect(left).toHaveTextContent('Scope creepPat · 0 votes · partly discussed, 0:07')
    expect(left).toHaveTextContent('Decision logPat · 0 votes · skipped after 0:05')
  })

  it('says no topics were added on a board without any', () => {
    render(<WrapUp ctx={makeCtx('u2', [], vi.fn(), { phase: 'ended' })} remaining={null} />)
    expect(screen.getByRole('region', { name: 'Not discussed' })).toHaveTextContent(
      'No topics were added.',
    )
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

  it('says what to do when a take-away or an action is only spaces', async () => {
    const { act, user } = setup('u2')
    const box = screen.getByLabelText('Your take-away')
    await user.type(box, '   ')
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(said()).toContain('Write a take-away first, or press Pass.')
    const field = screen.getByLabelText('New action')
    await user.type(field, '  ')
    await user.click(screen.getByRole('button', { name: 'Add action' }))
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(said()).toContain('Write an action first.')
    expect(act).not.toHaveBeenCalled()
  })

  it('counts a take-away from someone removed after sharing, so it never says 2 of 1', () => {
    const ctx = makeCtx('u1', topics(), vi.fn(), { phase: 'wrapup' })
    ctx.board.data.participants = ctx.board.data.participants.filter((p) => p.user_id === 'u1')
    ctx.board.data.takeaways = [
      ...TAKEAWAYS,
      {
        id: 'k2',
        board_id: 'b1',
        user_id: 'u2',
        author_name: 'Pat',
        text: 'Checklists',
        passed: false,
      },
      {
        id: 'k3',
        board_id: 'b1',
        user_id: 'u3',
        author_name: 'Quinn',
        text: 'Docs',
        passed: false,
      },
    ]
    render(<WrapUp ctx={ctx} remaining={null} />)
    expect(screen.getByText('2 of 3 shared')).toBeInTheDocument()
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
    expect(stage).toHaveTextContent(/^WRAPPING UP/)
    // The ring every other phase uses, so it turns orange with "1 min left" too.
    expect(within(stage).getByRole('timer')).toHaveTextContent('4:00of 5:00')
    // In the toolbar, so the shared take-aways come up the share.
    for (const name of ['Pause', 'Remove 1 minute', 'Add 1 minute']) {
      expect(within(stage).queryByRole('button', { name })).toBeNull()
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Ending cannot be undone, so it asks first, as in every other phase.
    await user.click(screen.getByRole('button', { name: 'End session' }))
    expect(act).not.toHaveBeenCalledWith('end_session', expect.anything(), expect.anything())
    const dialog = screen.getByRole('dialog', { name: 'End the session now?' })
    await user.click(within(dialog).getByRole('button', { name: 'End session now' }))
    expect(act).toHaveBeenCalledWith(
      'end_session',
      { p_board: 'b1' },
      { quiet: ['invalid_phase_order'] },
    )
    await user.click(screen.getByRole('button', { name: 'Download Word file' }))
    expect(download).toHaveBeenCalledWith(
      'docx',
      expect.objectContaining({ topics: expect.any(Array) }),
    )
  })

  it('warns before ending about who has not shared and what you have not sent', async () => {
    const { act, user } = setup('u1')
    await user.type(screen.getByLabelText('Your take-away'), 'Half a thought')
    await user.type(screen.getByLabelText('New action'), 'Half an action')
    await user.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('dialog', { name: 'End the session now?' })
    // Fran passed; Pat has not shared or passed.
    expect(dialog).toHaveTextContent(
      '1 person has not shared a take-away or passed yet. Anything they are still typing is lost.',
    )
    expect(dialog).toHaveTextContent(
      'Your take-away is not shared yet. Your new action is not added yet.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(act).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Your take-away')).toHaveValue('Half a thought')
  })

  it('ends once for a double press on End session now', async () => {
    const { act, user } = setup('u1')
    act.mockImplementation(() => new Promise<boolean>(() => {}))
    await user.click(screen.getByRole('button', { name: 'End session' }))
    await user.dblClick(screen.getByRole('button', { name: 'End session now' }))
    expect(act.mock.calls.filter(([fn]) => fn === 'end_session')).toHaveLength(1)
  })

  it('puts the downloads and End session before new actions, and Downloads in the toolbar', () => {
    setup('u1')
    const before = (a: HTMLElement, b: HTMLElement) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const add = screen.getByRole('textbox', { name: 'New action' })
    expect(before(screen.getByRole('textbox', { name: 'Your take-away' }), add)).toBe(true)
    expect(before(screen.getByRole('button', { name: 'Download Excel file' }), add)).toBe(true)
    expect(before(screen.getByRole('button', { name: 'End session' }), add)).toBe(true)
    expect(screen.getByRole('button', { name: 'Downloads' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    )
    // Before the shared take-aways too, so a long list cannot push them off the share.
    const shared = screen.getByText('Passed.')
    expect(before(screen.getByRole('button', { name: 'End session' }), shared)).toBe(true)
  })

  it('keeps focus on a download button while the file is built, then says it is ready', async () => {
    let finish = () => {}
    vi.mocked(download).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    )
    const { user } = setup('u2')
    const word = screen.getByRole('button', { name: 'Download Word file' })
    await user.click(word)
    // Not disabled, so focus stays; a second press does nothing while it is built.
    expect(word).toHaveTextContent('Preparing…')
    expect(word).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Download Excel file' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    finish()
    await waitFor(() => expect(said()).toContain('The Word file is ready.'))
    expect(word).toHaveTextContent('Download Word file')
    expect(word).toHaveFocus()
  })

  it('builds one file at a time', async () => {
    vi.mocked(download).mockImplementationOnce(() => new Promise<void>(() => {}))
    const { user } = setup('u2')
    await user.click(screen.getByRole('button', { name: 'Download Word file' }))
    await user.click(screen.getByRole('button', { name: 'Download Excel file' }))
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('lays out right-to-left topics, names and take-aways in their own direction', () => {
    setup('u1')
    const card = within(screen.getByRole('region', { name: 'Not discussed' })).getByText(
      'Scope creep',
    )
    expect(card).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('textbox', { name: 'Your take-away' })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('textbox', { name: 'New action' })).toHaveAttribute('dir', 'auto')
    const stage = screen.getByRole('region', { name: 'Wrap-up' })
    expect(within(stage).getByText('Fran').closest('bdi')).not.toBeNull()
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
    expect(screen.getByRole('region', { name: 'Session ended' })).toHaveTextContent(
      /^SESSION ENDED/,
    )
    expect(screen.getByRole('button', { name: 'Downloads' })).toBeEnabled()
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
    await user.click(screen.getByRole('button', { name: 'End session now' }))
    rerender(ENDED)
    expect(screen.getByRole('heading', { level: 1, name: 'This session has ended' })).toHaveFocus()
  })
})
