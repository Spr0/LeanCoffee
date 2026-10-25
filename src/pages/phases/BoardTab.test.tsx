import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardTab from './BoardTab'
import { makeCtx, makeTopic } from './testBoard'

// jsdom has no modal dialogs; open and close by attribute, as the browser would.
const TOPICS = [
  makeTopic('t1', 'Open topic', 'open', 1),
  makeTopic('t2', 'On stage', 'discussing', 2),
  makeTopic('t3', 'Done topic', 'discussed', 3),
  makeTopic('t4', 'Skipped topic', 'skipped', 4),
]

function setup(userId = 'u1') {
  const act = vi.fn(async () => true)
  render(<BoardTab ctx={makeCtx(userId, TOPICS, act)} totals={new Map()} />)
  return { act, user: userEvent.setup() }
}

describe('BoardTab', () => {
  it('shows skipped topics to everyone, with Bring back for the facilitator only', async () => {
    const { act, user } = setup()
    const skipped = screen.getByRole('region', { name: 'Skipped' })
    expect(skipped).toHaveTextContent('Skipped topic')
    await user.click(within(skipped).getByRole('button', { name: 'Bring back "Skipped topic"' }))
    expect(act).toHaveBeenCalledWith('restore_topic', { p_topic: 't4' })
    expect(screen.getByRole('status')).toHaveTextContent(
      '"Skipped topic" is back at the end of the queue.',
    )
  })

  it('gives participants no edit, delete or bring back controls', () => {
    setup('u2')
    expect(screen.getByRole('region', { name: 'Skipped' })).toHaveTextContent('Skipped topic')
    expect(screen.queryByRole('button', { name: /^(Edit|Delete|Bring back) "/ })).toBeNull()
  })

  it('offers Edit on every card and Delete on all but the topic on stage', () => {
    setup()
    for (const text of ['Open topic', 'Done topic', 'Skipped topic']) {
      expect(screen.getByRole('button', { name: `Edit "${text}"` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Delete "${text}"` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Edit "On stage"' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete "On stage"' })).toBeNull()
  })

  it('edits inline with a linked character count, and Escape cancels', async () => {
    const { act, user } = setup()
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

    await user.click(screen.getByRole('button', { name: 'Edit "Done topic"' }))
    await user.clear(screen.getByRole('textbox', { name: 'Edit topic' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit topic' }), 'Renamed{Enter}')
    expect(act).toHaveBeenCalledWith('edit_topic', { p_topic: 't3', p_text: 'Renamed' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Done topic"' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Edit "Skipped topic"' }))
    await user.type(screen.getByRole('textbox', { name: 'Edit topic' }), ' again')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(act).toHaveBeenLastCalledWith('edit_topic', {
      p_topic: 't4',
      p_text: 'Skipped topic again',
    })
  })

  it('asks before deleting, then deletes', async () => {
    const { act, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Delete "Done topic"' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this topic?' })
    expect(dialog).toHaveTextContent('Done topic')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(act).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete "Done topic"' }))
    await user.click(screen.getByRole('button', { name: 'Delete topic' }))
    expect(act).toHaveBeenCalledWith('delete_topic', { p_topic: 't3' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the downloads to everyone', () => {
    setup('u2')
    expect(screen.getByRole('button', { name: 'Download Word file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download Excel file' })).toBeEnabled()
  })
})
