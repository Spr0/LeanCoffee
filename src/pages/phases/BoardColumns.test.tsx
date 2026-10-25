import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Action } from '../../lib/types'
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

function queue(userId = 'u1', over = {}) {
  const act = vi.fn(async () => true)
  const onNote = vi.fn()
  render(
    <QueueColumn ctx={makeCtx(userId, TOPICS, act, over)} totals={new Map()} onNote={onNote} />,
  )
  return { act, onNote, user: userEvent.setup() }
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

  it('moves a topic up the queue; Up next has no move', async () => {
    const { act, user } = queue()
    expect(screen.getByRole('button', { name: 'Move "Open topic" up' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move "Later topic" up' }))
    expect(act).toHaveBeenCalledWith('reorder_topics', { p_board: 'b1', p_ids: ['t5', 't1'] })
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

  it('counts characters in the parking lot, and hides it when topics are closed', async () => {
    const { user } = queue('u2')
    const input = screen.getByLabelText('Add a topic to the end of the queue')
    expect(input).toHaveAccessibleDescription('0 of 160 characters')
    await user.type(input, 'Budget')
    expect(input).toHaveAccessibleDescription('6 of 160 characters')
  })

  it('has no parking lot once topic submissions are closed', () => {
    queue('u2', { topics_locked: true })
    expect(screen.queryByLabelText('Add a topic to the end of the queue')).toBeNull()
  })
})

const action = (id: string, topic: string, text: string, owner: string | null, done = false) =>
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

describe('DiscussedColumn', () => {
  function discussed(userId = 'u2') {
    const act = vi.fn(async () => true)
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
    ]
    render(<DiscussedColumn ctx={ctx} totals={new Map([['t1', 6]])} />)
    return { act, user: userEvent.setup() }
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

  it('explains the column before anything is discussed', () => {
    render(
      <DiscussedColumn
        ctx={makeCtx('u2', [makeTopic('t1', 'Open', 'open')], vi.fn())}
        totals={new Map()}
      />,
    )
    expect(screen.getByRole('region', { name: 'Discussed' })).toHaveTextContent(
      'Topics move here once discussed',
    )
    expect(screen.queryByText(/discussed so far/)).toBeNull()
  })
})
