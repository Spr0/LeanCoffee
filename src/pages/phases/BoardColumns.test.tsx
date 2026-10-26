import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Action, Topic } from '../../lib/types'
import { DiscussedColumn, QueueColumn } from './BoardColumns'
import { makeCtx, makeTopic } from './testBoard'

// jsdom has no modal dialogs; open and close by attribute, as the browser would.
const TOPICS = [
  makeTopic('t1', 'Open topic', 'open', 1),
  makeTopic('t2', 'On stage', 'discussing', 2),
  makeTopic('t3', 'Done topic', 'discussed', 3),
  makeTopic('t4', 'Skipped topic', 'skipped', 4),
  makeTopic('t5', 'Later topic', 'open', 5),
]

const action = (
  id: string,
  topic: string | null,
  text: string,
  owner: string | null,
  done = false,
) =>
  ({
    id,
    board_id: 'b1',
    topic_id: topic,
    text,
    owner_name: owner,
    created_by: 'u2',
    done,
    created_at: '2026-10-25T10:00:00Z',
  }) satisfies Action

function queue(userId = 'u1', over = {}, topics: Topic[] = TOPICS, actions: Action[] = []) {
  const act = vi.fn(async () => true)
  const onNote = vi.fn()
  const column = (list: Topic[], facilitator?: boolean) => {
    const ctx = makeCtx(userId, list, act, over)
    ctx.board.data.actions = actions
    if (facilitator !== undefined) ctx.isFacilitator = facilitator
    return <QueueColumn ctx={ctx} totals={new Map()} onNote={onNote} />
  }
  const view = render(column(topics))
  return {
    act,
    onNote,
    user: userEvent.setup(),
    rerender: (t: Topic[], facilitator?: boolean) => view.rerender(column(t, facilitator)),
  }
}

describe('QueueColumn', () => {
  it('lists the queue with Up next first, then Skipped, under a heading with the count', () => {
    queue('u2')
    const column = screen.getByRole('region', { name: 'To discuss' })
    expect(within(column).getByRole('heading', { level: 2 })).toHaveTextContent('To discuss 2')
    const items = within(screen.getByRole('list', { name: 'To discuss 2' })).getAllByRole(
      'listitem',
    )
    expect(items.map((li) => li.textContent)).toEqual([
      'UP NEXTOpen topicPat · 0 votes',
      'Later topicPat · 0 votes',
    ])
    expect(within(column).getByRole('heading', { level: 3 })).toHaveTextContent('Skipped 1')
    expect(screen.getByRole('list', { name: 'Skipped 1' })).toHaveTextContent('Skipped topic')
    expect(column).not.toHaveTextContent('On stage')
    expect(column).not.toHaveTextContent('Done topic')
  })

  it('gives participants no move, edit, delete or bring back controls', () => {
    queue('u2')
    expect(screen.queryByRole('button', { name: /^(Move|Edit|Delete|Bring back) "/ })).toBeNull()
    expect(screen.getByLabelText('Add a topic to the end of the queue')).toBeInTheDocument()
  })

  it('brings a skipped topic back and moves focus to the queue', async () => {
    const { act, onNote, user } = queue()
    await user.click(screen.getByRole('button', { name: 'Bring back "Skipped topic"' }))
    expect(act).toHaveBeenCalledWith('restore_topic', { p_topic: 't4' })
    expect(onNote).toHaveBeenCalledWith('"Skipped topic" is back at the end of the queue.')
    expect(screen.getByRole('list', { name: 'To discuss 2' })).toHaveFocus()
  })

  it('moves a topic up the queue and says where it went; Up next has no move', async () => {
    const { act, onNote, user, rerender } = queue()
    const top = screen.getByRole('button', { name: 'Move "Open topic" up' })
    expect(top).toHaveAttribute('aria-disabled', 'true')
    await user.click(top)
    expect(act).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Move "Later topic" up' }))
    expect(act).toHaveBeenCalledWith('reorder_topics', { p_board: 'b1', p_ids: ['t5', 't1'] })
    // The arrow keeps focus and its name, so the live line says the new place.
    expect(onNote).toHaveBeenCalledWith('"Later topic" is now up next.')
    // At the top its button stays in place, so focus is not lost.
    rerender(TOPICS.map((t) => (t.id === 't5' ? { ...t, sort_order: 0 } : t)))
    const moved = screen.getByRole('button', { name: 'Move "Later topic" up' })
    expect(moved).toHaveFocus()
    expect(moved).toHaveAttribute('aria-disabled', 'true')
  })

  it('closes an editor whose card leaves the queue, so it does not reopen later', async () => {
    const { user, rerender } = queue()
    await user.click(screen.getByRole('button', { name: 'Edit "Open topic"' }))
    expect(screen.getByRole('textbox', { name: 'Edit topic' })).toHaveFocus()
    const status = (s: Topic['status']) =>
      TOPICS.map((t) => (t.id === 't1' ? { ...t, status: s } : t))
    rerender(status('discussing'))
    rerender(status('skipped'))
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Open topic"' })).not.toHaveFocus()
  })

  it('closes an open editor when the facilitator role moves away', async () => {
    const { user, rerender } = queue()
    await user.click(screen.getByRole('button', { name: 'Edit "Open topic"' }))
    expect(screen.getByRole('textbox', { name: 'Edit topic' })).toBeInTheDocument()
    rerender(TOPICS, false)
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    // Given back, the editor does not reopen by itself.
    rerender(TOPICS, true)
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
  })

  it('says so when no topic is waiting', () => {
    queue('u2', {}, [makeTopic('t3', 'Done topic', 'discussed', 3)])
    expect(screen.getByRole('region', { name: 'To discuss' })).toHaveTextContent(
      'No topics waiting.',
    )
  })

  it('keeps the parking lot field in sight as the queue grows above it', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = queue('u2')
    screen.getByLabelText('Add a topic to the end of the queue').focus()
    rerender([...TOPICS, makeTopic('t6', 'Parked', 'open', 6)])
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    // Not when the field does not have focus.
    scroll.mockClear()
    screen.getByLabelText('Add a topic to the end of the queue').blur()
    rerender([...TOPICS, makeTopic('t6', 'Parked', 'open', 6), makeTopic('t7', 'More', 'open', 7)])
    expect(scroll).not.toHaveBeenCalled()
  })

  it('lays right-to-left topics and names out in their own direction', () => {
    queue('u2', {}, [{ ...makeTopic('t1', 'كيف نقرر API v2', 'open', 1), author_name: 'عبد' }])
    const card = screen.getByText('كيف نقرر API v2')
    expect(card).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('عبد').tagName).toBe('BDI')
  })

  it('keeps actions from a deferred or skipped topic under its card', () => {
    queue('u2', {}, TOPICS, [
      action('a1', 't4', 'From the skipped topic', 'Maya'),
      action('a2', 't5', 'From the deferred topic', null),
    ])
    expect(screen.getByRole('list', { name: 'Actions from "Skipped topic"' })).toHaveTextContent(
      'From the skipped topic · Maya',
    )
    expect(
      screen.getByRole('checkbox', { name: 'Done: From the deferred topic' }),
    ).toBeInTheDocument()
  })

  it('offers Edit and Delete on every queued and skipped card', () => {
    queue()
    for (const text of ['Open topic', 'Later topic', 'Skipped topic']) {
      expect(screen.getByRole('button', { name: `Edit "${text}"` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Delete "${text}"` })).toBeInTheDocument()
    }
  })

  it('edits inline with a linked character count, and Escape cancels', async () => {
    const { act, user } = queue()
    await user.click(screen.getByRole('button', { name: 'Edit "Open topic"' }))
    const input = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('maxLength', '160')
    expect(input).toHaveAccessibleDescription('10 of 160 characters')
    await user.type(input, '!')
    expect(input).toHaveAccessibleDescription('11 of 160 characters')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Open topic"' })).toHaveFocus()
    expect(act).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Edit "Skipped topic"' }))
    await user.clear(screen.getByRole('textbox', { name: 'Edit topic' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit topic' }), 'Renamed{Enter}')
    expect(act).toHaveBeenCalledWith('edit_topic', { p_topic: 't4', p_text: 'Renamed' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Skipped topic"' })).toHaveFocus()
  })

  it('asks before deleting, then deletes and moves focus to the heading', async () => {
    const { act, onNote, user } = queue()
    await user.click(screen.getByRole('button', { name: 'Delete "Later topic"' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this topic?' })
    expect(dialog).toHaveTextContent('Later topic')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(act).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete "Later topic"' }))
    await user.click(screen.getByRole('button', { name: 'Delete topic' }))
    expect(act).toHaveBeenCalledWith('delete_topic', { p_topic: 't5' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onNote).toHaveBeenCalledWith('"Later topic" was deleted.')
    expect(screen.getByRole('heading', { level: 2, name: 'To discuss 2' })).toHaveFocus()
  })

  it('counts characters in the parking lot, shown once something is typed', async () => {
    const { user } = queue('u2')
    const input = screen.getByLabelText('Add a topic to the end of the queue')
    expect(input).toHaveAccessibleDescription('0 of 160 characters')
    expect(screen.getByText('0 of 160 characters')).toHaveClass('sr-only')
    await user.type(input, 'Budget')
    expect(input).toHaveAccessibleDescription('6 of 160 characters')
    expect(screen.getByText('6 of 160 characters')).not.toHaveClass('sr-only')
  })

  it('has no parking lot once topic submissions are closed', () => {
    queue('u2', { topics_locked: true })
    expect(screen.queryByLabelText('Add a topic to the end of the queue')).toBeNull()
  })
})

describe('DiscussedColumn', () => {
  function discussed(userId = 'u2', extra: Action[] = []) {
    const act = vi.fn(async () => true)
    const onNote = vi.fn()
    const topics = [
      { ...makeTopic('t1', 'First done', 'discussed', 2), time_spent_ms: 420_000 },
      { ...makeTopic('t2', 'Second done', 'discussed', 1), time_spent_ms: 580_000, extensions: 1 },
      makeTopic('t3', 'On stage', 'discussing', 3),
    ]
    const ctx = makeCtx(userId, topics, act)
    ctx.board.data.actions = [
      action('a1', 't1', 'Draft a checklist', 'Maya'),
      action('a2', 't3', 'From the stage', null),
      action('a3', 't2', 'Trial a format', null, true),
      ...extra,
    ]
    render(<DiscussedColumn ctx={ctx} totals={new Map([['t1', 6]])} onNote={onNote} />)
    return { act, onNote, user: userEvent.setup() }
  }

  it('lists discussed topics in order with time, votes, extensions and actions', () => {
    discussed()
    const column = screen.getByRole('region', { name: 'Discussed' })
    expect(within(column).getByRole('heading', { level: 2 })).toHaveTextContent('Discussed 2')
    const cards = within(column)
      .getAllByRole('listitem')
      .filter((li) => li.closest('ul') === null)
    expect(cards.map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Second done',
      'First done',
    ])
    expect(cards[0]).toHaveTextContent('9:40 · 0 votes · extended once')
    expect(cards[1]).toHaveTextContent('7:00 · 6 votes')
    expect(screen.getByRole('list', { name: 'Actions from "First done"' })).toHaveTextContent(
      'Draft a checklist · Maya',
    )
    expect(column).not.toHaveTextContent('From the stage')
    expect(column).toHaveTextContent('16:40 discussed so far · 3 actions in all')
  })

  it('lets anyone tick an action done', async () => {
    const { act, user } = discussed()
    expect(screen.getByRole('checkbox', { name: 'Done: Trial a format' })).toBeChecked()
    await user.click(screen.getByText('Draft a checklist'))
    expect(act).toHaveBeenCalledWith('toggle_action', { p_action: 'a1', p_done: true })
  })

  it('ticks at once, and unticks if the server refuses', async () => {
    let answer: (ok: boolean) => void = () => {}
    const { act, user } = discussed()
    act.mockImplementation(() => new Promise<boolean>((done) => (answer = done)))
    const box = screen.getByRole('checkbox', { name: 'Done: Draft a checklist' })
    await user.click(box)
    expect(box).toBeChecked()
    answer(false)
    await vi.waitFor(() => expect(box).not.toBeChecked())
  })

  it('keeps every card inside the column, whatever the link or owner', () => {
    discussed('u2', [
      action(
        'a5',
        't1',
        'Read https://confluence.example.com/display/ENG/Intake-2026',
        'Maximiliana Featherstone',
      ),
    ])
    const list = screen.getByRole('list', { name: 'Discussed 2' })
    // grid-cols-1 is minmax(0, 1fr): one long word cannot widen the track.
    expect(list).toHaveClass('grid-cols-1')
    const owner = screen.getByText('Maximiliana Featherstone')
    expect(owner.tagName).toBe('BDI')
    expect(owner.closest('b')).not.toHaveClass('whitespace-nowrap')
  })

  it('lists actions left without a topic by a delete, and counts them in the total', () => {
    discussed('u2', [action('a4', null, 'From a deleted topic', 'Leo')])
    const others = screen.getByRole('list', { name: 'Other actions 1' })
    expect(others).toHaveTextContent('From a deleted topic · Leo')
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent('4 actions in all')
  })

  it('lets the facilitator edit and delete a discussed topic; participants cannot', async () => {
    const { act, onNote, user } = discussed('u1')
    await user.click(screen.getByRole('button', { name: 'Edit "First done"' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit topic' }), ', fixed{Enter}')
    expect(act).toHaveBeenCalledWith('edit_topic', { p_topic: 't1', p_text: 'First done, fixed' })
    expect(screen.getByRole('button', { name: 'Edit "First done"' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Delete "Second done"' }))
    await user.click(screen.getByRole('button', { name: 'Delete topic' }))
    expect(act).toHaveBeenCalledWith('delete_topic', { p_topic: 't2' })
    expect(onNote).toHaveBeenCalledWith('"Second done" was deleted.')
    expect(screen.getByRole('heading', { level: 2, name: 'Discussed 2' })).toHaveFocus()
  })

  it('gives participants no edit or delete on discussed topics', () => {
    discussed('u2')
    expect(screen.queryByRole('button', { name: /^(Edit|Delete) "/ })).toBeNull()
  })

  it('explains the column before anything is discussed', () => {
    render(
      <DiscussedColumn
        ctx={makeCtx('u2', [makeTopic('t1', 'Open', 'open')], vi.fn())}
        totals={new Map()}
        onNote={vi.fn()}
      />,
    )
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent(
      'Topics move here once discussed',
    )
    expect(screen.queryByText(/discussed so far/)).toBeNull()
  })

  it('says nothing was discussed from Wrap-up on, and drops "so far"', () => {
    const { rerender } = render(
      <DiscussedColumn
        ctx={makeCtx('u2', [makeTopic('t1', 'Open', 'open')], vi.fn(), { phase: 'wrapup' })}
        totals={new Map()}
        onNote={vi.fn()}
      />,
    )
    const column = screen.getByRole('region', { name: 'Discussed' })
    expect(column).toHaveTextContent('No topics were discussed.')
    const done = { ...makeTopic('t1', 'Done', 'discussed'), time_spent_ms: 300_000 }
    rerender(
      <DiscussedColumn
        ctx={makeCtx('u2', [done], vi.fn(), { phase: 'wrapup' })}
        totals={new Map()}
        onNote={vi.fn()}
      />,
    )
    expect(column).toHaveTextContent('5:00 discussed · 0 actions in all')
  })

  it('is read-only on the ended board: no Edit or Delete, done boxes disabled (D61)', async () => {
    const act = vi.fn(async () => true)
    const ctx = makeCtx('u1', [makeTopic('t1', 'Done', 'discussed')], act, { phase: 'ended' })
    ctx.board.data.actions = [
      action('a1', 't1', 'Ship it', null),
      action('a2', null, 'Loose', null),
    ]
    render(<DiscussedColumn ctx={ctx} totals={new Map()} onNote={vi.fn()} readOnly />)
    expect(screen.queryByRole('button', { name: /^(Edit|Delete) "/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Done: Ship it' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Done: Loose' })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Done: Ship it' }))
    expect(act).not.toHaveBeenCalled()
  })
})
