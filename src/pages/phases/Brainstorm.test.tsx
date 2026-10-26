import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeCtx, topic } from '../../test/boardContext'
import Brainstorm from './Brainstorm'

// Closing the phase at zero calls the server; nothing here reaches zero.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))

const stopped = { phase: 'brainstorm' as const, paused_remaining_ms: 300_000 }
const running = {
  phase: 'brainstorm' as const,
  phase_ends_at: new Date(Date.now() + 200_000).toISOString(),
}
// The phase's live line is the last status in main; the people button has its own.
const liveLine = () => within(screen.getByRole('main')).getAllByRole('status').at(-1)
const column = () => screen.getByRole('region', { name: 'To discuss' })

describe('Brainstorm clock (decision D64)', () => {
  it('gives the facilitator a start button while the clock has never run', () => {
    const ctx = makeCtx({ state: stopped })
    render(<Brainstorm ctx={ctx} remaining={300_000} />)
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.getByRole('timer')).toHaveTextContent('5:00of 5:00')
    fireEvent.click(screen.getByRole('button', { name: 'Start the 5:00 clock' }))
    expect(ctx.act).toHaveBeenCalledWith('timer_resume', { p_board: 'b1' })
    expect(screen.getByRole('button', { name: 'End brainstorm now' })).toBeEnabled()
  })

  it('tells participants the clock has not started yet', () => {
    render(<Brainstorm ctx={makeCtx({ userId: 'u2', state: stopped })} remaining={300_000} />)
    expect(screen.getByText('The clock starts when the facilitator is ready.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Start the/ })).toBeNull()
    expect(liveLine()).toHaveTextContent(/^$/)
  })

  it('announces the start once to participants who saw it stopped', () => {
    const { rerender } = render(
      <Brainstorm ctx={makeCtx({ userId: 'u2', state: stopped })} remaining={300_000} />,
    )
    rerender(<Brainstorm ctx={makeCtx({ userId: 'u2', state: running })} remaining={200_000} />)
    expect(liveLine()).toHaveTextContent('The clock has started.')
    expect(screen.queryByText('The clock starts when the facilitator is ready.')).toBeNull()
  })

  it('shows the usual timer buttons once the clock has started', () => {
    render(<Brainstorm ctx={makeCtx({ state: running })} remaining={200_000} />)
    expect(screen.queryByRole('button', { name: /Start the/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove 1 minute' })).toBeEnabled()
  })

  it('treats a clock paused part way as paused, not unstarted', () => {
    const paused = { phase: 'brainstorm' as const, paused_remaining_ms: 120_000 }
    render(<Brainstorm ctx={makeCtx({ state: paused })} remaining={120_000} />)
    expect(screen.queryByRole('button', { name: /Start the/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(screen.getByRole('timer')).toHaveTextContent('Paused')
  })
})

describe('Brainstorm as the board', () => {
  const mine = [topic('t1', 'Retro cadence', 'u2'), topic('t2', 'Pairing', 'u2')]

  it('is To discuss, the stage and Discussed, with one h1 and counted column headings', () => {
    render(
      <Brainstorm
        ctx={makeCtx({ userId: 'u2', state: { ...running, topic_count: 3 }, topics: mine })}
        remaining={200_000}
      />,
    )
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['To discuss', 'Brainstorm', 'Discussed'])
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Write the topics you want to talk about',
    ])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'To discuss 3',
      'Discussed 0',
    ])
    expect(screen.getByText('3 topics so far')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 people' })).toBeInTheDocument()
  })

  it('stacks the stage first on a phone, so focus and reading order match the screen', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    render(<Brainstorm ctx={makeCtx({ userId: 'u2', state: running })} remaining={200_000} />)
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Brainstorm', 'To discuss', 'Discussed'])
    vi.unstubAllGlobals()
  })

  it('writes and shows topics in their own direction', () => {
    render(
      <Brainstorm ctx={makeCtx({ userId: 'u2', state: running, topics: mine })} remaining={1} />,
    )
    expect(screen.getByLabelText('New topic')).toHaveAttribute('dir', 'auto')
    for (const li of within(column()).getAllByRole('listitem'))
      expect(li.querySelector('p[dir="auto"]')).not.toBeNull()
  })

  it('shows hidden cards face down from the count alone, never their words', () => {
    // The database returned only Pat's two cards; three more exist.
    render(
      <Brainstorm
        ctx={makeCtx({ userId: 'u2', state: { ...running, topic_count: 5 }, topics: mine })}
        remaining={200_000}
      />,
    )
    expect(within(column()).getByRole('heading', { level: 2 })).toHaveTextContent('To discuss 5')
    expect(within(column()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(column()).getAllByText('YOURS')).toHaveLength(2)
    const backs = within(column()).getAllByText('Face down until Clarify')
    expect(backs).toHaveLength(3)
    for (const back of backs) expect(back.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(column()).toHaveTextContent('3 from others, hidden until Clarify')
    expect(screen.getByText(/stay face down until Clarify/)).toBeInTheDocument()
  })

  it('shows others’ cards face up, read-only, when the database returns them', () => {
    const topics = [...mine, topic('t3', 'Flaky tests', 'u1')]
    render(
      <Brainstorm
        ctx={makeCtx({
          userId: 'u2',
          state: { ...running, topic_count: 3 },
          settings: { hide_topics: false },
          topics,
        })}
        remaining={200_000}
      />,
    )
    const theirs = within(column()).getAllByRole('listitem')[2] as HTMLElement
    expect(theirs).toHaveTextContent('Flaky testsFran')
    expect(within(theirs).queryByRole('button')).toBeNull()
    expect(screen.queryByText('Face down until Clarify')).toBeNull()
    expect(screen.getByText(/Everyone sees the cards as they are written/)).toBeInTheDocument()
  })

  it('adds a topic, says so on the live line and counts it against the five', async () => {
    const ctx = makeCtx({ userId: 'u2', state: running, topics: mine })
    render(<Brainstorm ctx={ctx} remaining={200_000} />)
    const box = screen.getByRole('textbox', { name: 'New topic' })
    expect(box).toHaveAccessibleDescription(
      '0 of 160 characters · 2 of 5 used · Press Enter to add',
    )
    fireEvent.change(box, { target: { value: 'Async updates' } })
    expect(box).toHaveAccessibleDescription(
      '13 of 160 characters · 2 of 5 used · Press Enter to add',
    )
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(ctx.act).toHaveBeenCalledWith('add_topic', { p_board: 'b1', p_text: 'Async updates' })
    await waitFor(() => expect(liveLine()).toHaveTextContent('Added "Async updates". 3 of 5 used.'))
    expect(box).toHaveValue('')
  })

  it('stops at five topics', () => {
    const five = [1, 2, 3, 4, 5].map((i) => topic(`t${i}`, `Topic ${i}`, 'u2'))
    render(
      <Brainstorm ctx={makeCtx({ userId: 'u2', state: running, topics: five })} remaining={1} />,
    )
    const box = screen.getByRole('textbox', { name: 'New topic' })
    expect(box).toBeDisabled()
    expect(box).toHaveAttribute('placeholder', 'You have added 5 topics, the most allowed.')
    expect(screen.getByRole('button', { name: 'Add topic' })).toBeDisabled()
  })

  it('deletes your own card at once and moves focus to the column heading', async () => {
    const ctx = makeCtx({ userId: 'u2', state: running, topics: mine })
    render(<Brainstorm ctx={ctx} remaining={200_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Pairing"' }))
    expect(ctx.act).toHaveBeenCalledWith('delete_topic', { p_topic: 't2' })
    await waitFor(() => expect(within(column()).getByRole('heading', { level: 2 })).toHaveFocus())
    expect(liveLine()).toHaveTextContent('"Pairing" was deleted.')
  })

  it('gives the facilitator no Edit or Delete on others’ cards', () => {
    render(
      <Brainstorm
        ctx={makeCtx({ state: running, settings: { hide_topics: false }, topics: mine })}
        remaining={200_000}
      />,
    )
    expect(within(column()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(column()).queryByRole('button')).toBeNull()
  })
})

describe('Brainstorm topic editing', () => {
  it('shows a character counter while editing a topic, and Escape returns to Edit', () => {
    const ctx = makeCtx({ state: running, topics: [topic('t1', 'Retro cadence', 'u1')] })
    render(<Brainstorm ctx={ctx} remaining={200_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Retro cadence"' }))
    const input = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(input).toHaveFocus()
    expect(input).toHaveAccessibleDescription('13 of 160 characters')
    fireEvent.change(input, { target: { value: 'Retro' } })
    expect(screen.getByText('5 of 160 characters')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Retro cadence"' })).toHaveFocus()
    expect(ctx.act).not.toHaveBeenCalled()
  })

  it('saves an edit with the same server call', async () => {
    const ctx = makeCtx({ state: running, topics: [topic('t1', 'Retro cadence', 'u1')] })
    render(<Brainstorm ctx={ctx} remaining={200_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Retro cadence"' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit topic' }), {
      target: { value: 'Retro format' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.act).toHaveBeenCalledWith('edit_topic', { p_topic: 't1', p_text: 'Retro format' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull())
  })
})
