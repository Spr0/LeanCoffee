import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeCtx, topic } from '../../test/boardContext'
import Clarify from './Clarify'

// jsdom has no modal dialogs; open and close by attribute.
const NINE = Array.from({ length: 9 }, (_, i) => topic(`t${i + 1}`, `Topic ${i + 1}`))
const clarify = { phase: 'clarify' as const }
// The phase's live line is the last status in main; the people button has its own.
const liveLine = () => within(screen.getByRole('main')).getAllByRole('status').at(-1)
const column = () => screen.getByRole('region', { name: 'To discuss' })
const stage = () => screen.getByRole('region', { name: 'Clarify' })

describe('Clarify dots suggestion (spec section 3)', () => {
  it('suggests topics / 2, at most 5, and applies it', () => {
    const ctx = makeCtx({ state: clarify, topics: NINE })
    render(<Clarify ctx={ctx} remaining={null} />)
    expect(screen.getByText('Suggested: 5 dots each (topics / 2, at most 5)')).toBeInTheDocument()
    expect(screen.getByText('Dots per person: 3 each')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use 5 dots' }))
    expect(ctx.act).toHaveBeenCalledWith('update_settings', {
      p_board: 'b1',
      p_settings: { dots: 5 },
    })
  })

  it('counts merged cards once and disables the button when it already matches', () => {
    const topics = [
      topic('t1', 'One'),
      topic('t2', 'Two'),
      topic('t3', 'Three'),
      topic('t4', 'Four', 'u2', { merged_into: 't1' }),
    ]
    render(
      <Clarify ctx={makeCtx({ state: clarify, topics, settings: { dots: 2 } })} remaining={null} />,
    )
    expect(screen.getByText('Suggested: 2 dots each (topics / 2, at most 5)')).toBeInTheDocument()
    // Not disabled, so keyboard focus stays on it once applied; it does nothing more.
    const using = screen.getByRole('button', { name: 'Using 2 dots' })
    expect(using).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(using)
    expect(screen.getByText('Continue to voting opens 2 dots each and a 1:30 clock.')).toBeVisible()
  })

  it('keeps focus on the button once the suggestion is applied', () => {
    const topics = [topic('t1', 'One'), topic('t2', 'Two'), topic('t3', 'Three')]
    const ctx = makeCtx({ state: clarify, topics })
    const { rerender } = render(<Clarify ctx={ctx} remaining={null} />)
    const use = screen.getByRole('button', { name: 'Use 2 dots' })
    use.focus()
    fireEvent.click(use)
    expect(ctx.act).toHaveBeenCalledWith('update_settings', {
      p_board: 'b1',
      p_settings: { dots: 2 },
    })
    rerender(
      <Clarify ctx={makeCtx({ state: clarify, topics, settings: { dots: 2 } })} remaining={null} />,
    )
    expect(screen.getByRole('button', { name: 'Using 2 dots' })).toHaveFocus()
  })

  it('never suggests fewer than one dot', () => {
    render(
      <Clarify ctx={makeCtx({ state: clarify, topics: [topic('t1', 'Only')] })} remaining={null} />,
    )
    expect(screen.getByText('Suggested: 1 dot each (topics / 2, at most 5)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use 1 dot' })).toBeEnabled()
  })

  it('is shown to the facilitator only', () => {
    render(
      <Clarify ctx={makeCtx({ userId: 'u2', state: clarify, topics: NINE })} remaining={null} />,
    )
    expect(screen.queryByText(/^Suggested:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to voting' })).toBeNull()
  })
})

describe('Clarify as the board', () => {
  const topics = [topic('t1', 'Code review turnaround'), topic('t2', 'Retro cadence', 'u1')]

  it('is To discuss, the stage and Discussed, with one h1 and counted column headings', () => {
    render(<Clarify ctx={makeCtx({ userId: 'u2', state: clarify, topics })} remaining={null} />)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['To discuss', 'Clarify', 'Discussed'])
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Here is everything the group wrote',
    ])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'To discuss 2',
      'Discussed 0',
    ])
    expect(
      within(column())
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Code review turnaroundPat', 'Retro cadenceFran'])
    expect(stage()).toHaveTextContent('The facilitator starts the pitches')
  })

  it('stacks the stage first on a phone', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    render(<Clarify ctx={makeCtx({ state: clarify, topics })} remaining={null} />)
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('region')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Clarify', 'To discuss', 'Discussed'])
    vi.unstubAllGlobals()
  })

  it('tells the facilitator how to tidy up, then puts the merge on the stage', () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    expect(stage()).toHaveTextContent('To tidy up, select two cards that say the same thing')
    const first = screen.getByRole('button', { name: /^Code review turnaround/ })
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveTextContent('SELECTED')
    expect(stage()).toHaveTextContent('Selected "Code review turnaround". Select one more card')
    fireEvent.click(screen.getByRole('button', { name: /^Retro cadence/ }))
    expect(liveLine()).toHaveTextContent(
      'Two cards selected. Merge them or keep them separate on the stage.',
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Merge these two?')
    expect(stage()).toHaveTextContent('KEEPS ITS PLACECode review turnaroundPat')
    expect(stage()).toHaveTextContent('JOINS ITRetro cadenceFran')
    // The topics on stage are words, not buttons.
    expect(within(stage()).queryAllByRole('button', { name: /Code review turnaround/ })).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Merge 2 selected' }))
    expect(ctx.act).toHaveBeenCalledWith('merge_topics', { p_source: 't2', p_target: 't1' })
  })

  it('Keep separate clears the selection and focus goes to the stage heading', async () => {
    render(<Clarify ctx={makeCtx({ state: clarify, topics })} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Code review turnaround/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Retro cadence/ }))
    const keep = screen.getByRole('button', { name: 'Keep separate' })
    keep.focus()
    fireEvent.click(keep)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Here is everything the group wrote',
    )
    expect(screen.getByRole('button', { name: /^Code review turnaround/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('says on the merge stage which cards already carry merged cards', () => {
    const merged = [...topics, topic('t3', 'Slow reviews', 'u2', { merged_into: 't2' })]
    render(<Clarify ctx={makeCtx({ state: clarify, topics: merged })} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Code review turnaround/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Retro cadence/ }))
    expect(stage()).toHaveTextContent('JOINS ITRetro cadenceFran · 1 card merged in')
    expect(stage()).toHaveTextContent('KEEPS ITS PLACECode review turnaroundPatJOINS IT')
  })

  it('stacks merged cards under the card they joined, with Undo merge for the facilitator', () => {
    const merged = [...topics, topic('t3', 'Slow reviews', 'u2', { merged_into: 't1' })]
    const ctx = makeCtx({ state: clarify, topics: merged })
    render(<Clarify ctx={ctx} remaining={null} />)
    const stack = screen.getByRole('list', { name: 'Merged into "Code review turnaround"' })
    expect(stack).toHaveTextContent('+ Slow reviews (Pat)')
    expect(screen.getByText('2 topics')).toHaveTextContent('2 topics · 1 card merged')
    const undo = within(stack).getByRole('button', { name: 'Undo merge' })
    expect(undo).toHaveAccessibleDescription('+ Slow reviews (Pat)')
    expect(undo).toHaveClass('text-[15px]')
    fireEvent.click(undo)
    expect(ctx.act).toHaveBeenCalledWith('unmerge_topic', { p_topic: 't3' })
  })

  it('moves focus to the card taken out of a stack, as its Undo merge goes', async () => {
    const merged = [...topics, topic('t3', 'Slow reviews', 'u2', { merged_into: 't1' })]
    const ctx = makeCtx({ state: clarify, topics: merged })
    const { rerender } = render(<Clarify ctx={ctx} remaining={null} />)
    const undo = screen.getByRole('button', { name: 'Undo merge' })
    undo.focus()
    await act(async () => fireEvent.click(undo))
    const apart = [...topics, topic('t3', 'Slow reviews', 'u2')]
    rerender(
      <Clarify
        ctx={{ ...ctx, board: { ...ctx.board, data: { ...ctx.board.data, topics: apart } } }}
        remaining={null}
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /^Slow reviews/ })).toHaveFocus())
  })

  it('gives participants the board and the stage, but no controls', () => {
    const merged = [...topics, topic('t3', 'Slow reviews', 'u2', { merged_into: 't1' })]
    render(
      <Clarify ctx={makeCtx({ userId: 'u2', state: clarify, topics: merged })} remaining={null} />,
    )
    expect(within(column()).queryByRole('button')).toBeNull()
    expect(within(stage()).queryByRole('button')).toBeNull()
    expect(screen.getByText('+ Slow reviews', { exact: false })).toBeInTheDocument()
  })

  it('announces merges, deletes and pitches from the board, for everyone', () => {
    const ctx = (over: Parameters<typeof makeCtx>[0]) =>
      makeCtx({ userId: 'u2', state: clarify, ...over })
    const { rerender } = render(<Clarify ctx={ctx({ topics })} remaining={null} />)
    const merged = [topics[0], { ...topics[1], merged_into: 't1' }] as typeof topics
    rerender(<Clarify ctx={ctx({ topics: merged })} remaining={null} />)
    expect(liveLine()).toHaveTextContent(
      '"Retro cadence" was merged into "Code review turnaround".',
    )
    rerender(
      <Clarify
        ctx={ctx({ topics, state: { ...clarify, pitch_topic_id: 't2' } })}
        remaining={null}
      />,
    )
    expect(liveLine()).toHaveTextContent(
      '"Retro cadence" is a card of its own again. Fran is pitching "Retro cadence".',
    )
  })
})

describe('Clarify facilitator edit and delete', () => {
  const topics = [topic('t1', 'Code review turnaround'), topic('t2', 'Retro cadence')]

  it('names Edit and Delete after the topic, as on every other phase', () => {
    render(<Clarify ctx={makeCtx({ state: clarify, topics })} remaining={null} />)
    expect(
      screen.getAllByRole('button', { name: /Code review turnaround/ }).map((b) => b.textContent),
    ).toEqual(['Code review turnaroundPat', 'Edit', 'Delete'])
    expect(screen.getByRole('button', { name: 'Edit "Code review turnaround"' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete "Code review turnaround"' })).toBeVisible()
  })

  it('edits a topic inline with a counter; Escape cancels and returns to Edit', () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Retro cadence"' }))
    const box = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(box).toHaveFocus()
    expect(box).toHaveAccessibleDescription('13 of 160 characters')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit "Retro cadence"' })).toHaveFocus()
    expect(ctx.act).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit "Retro cadence"' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit topic' }), {
      target: { value: 'Retro cadence and format' },
    })
    expect(screen.getByText('24 of 160 characters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(ctx.act).toHaveBeenCalledWith('edit_topic', {
      p_topic: 't2',
      p_text: 'Retro cadence and format',
    })
  })

  it('asks before deleting a topic, then focuses the column heading', async () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete "Code review turnaround"' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this topic?' })
    expect(dialog).toHaveTextContent('Code review turnaround')
    expect(dialog).toHaveTextContent('It is removed for everyone')
    expect(ctx.act).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete topic' }))
    expect(ctx.act).toHaveBeenCalledWith('delete_topic', { p_topic: 't1' })
    await waitFor(() => expect(within(column()).getByRole('heading', { level: 2 })).toHaveFocus())
  })

  it('gives participants no edit or delete controls', () => {
    render(<Clarify ctx={makeCtx({ userId: 'u2', state: clarify, topics })} remaining={null} />)
    expect(screen.queryByRole('button', { name: /^(Edit|Delete) "/ })).toBeNull()
  })
})

describe('Clarify pitches', () => {
  const topics = [topic('t1', 'One'), topic('t2', 'Two')]
  const pitching = (id: string) => ({
    phase: 'clarify' as const,
    pitch_topic_id: id,
    phase_ends_at: new Date(Date.now() + 20_000).toISOString(),
  })

  it('puts the card being pitched on stage as the 44 px heading, with its clock', () => {
    render(
      <Clarify ctx={makeCtx({ userId: 'u2', state: pitching('t1'), topics })} remaining={20_000} />,
    )
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('One')
    expect(h1).toHaveClass('text-[44px]')
    expect(stage()).toHaveTextContent('PITCH 1 OF 2')
    expect(stage()).toHaveTextContent('Pat is pitching')
    expect(screen.getByRole('timer')).toHaveAccessibleName('0 minutes 20 seconds left')
    expect(within(column()).getAllByRole('listitem')[0]).toHaveTextContent('PITCHING NOW')
  })

  it('shows what was merged into the card on stage', () => {
    const merged = [...topics, topic('t3', 'Uno', 'u1', { merged_into: 't1' })]
    render(<Clarify ctx={makeCtx({ state: pitching('t1'), topics: merged })} remaining={20_000} />)
    expect(stage()).toHaveTextContent('Merged in: Uno (Fran)')
  })

  it('gives the facilitator timer buttons while a pitch clock runs', () => {
    const ctx = makeCtx({ state: pitching('t1'), topics: [topic('t1', 'One')] })
    render(<Clarify ctx={ctx} remaining={20_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove 15 seconds' }))
    expect(ctx.act).toHaveBeenCalledWith('timer_adjust', { p_board: 'b1', p_delta_s: -15 })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })

  it('lays out the pitched topic in its own direction', () => {
    render(<Clarify ctx={makeCtx({ state: pitching('t1'), topics })} remaining={20_000} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('dir', 'auto')
  })

  it('puts the pitch buttons with the ring, and Continue to voting in the toolbar', () => {
    const ctx = makeCtx({ state: pitching('t1'), topics })
    render(<Clarify ctx={ctx} remaining={20_000} />)
    // The ring and its buttons float beside the topic, so the buttons come before it.
    const h1 = screen.getByRole('heading', { level: 1 })
    for (const name of ['Pause', 'Next pitch', 'Stop pitching']) {
      const button = within(stage()).getByRole('button', { name })
      expect(button.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(stage()).queryByRole('button', { name: 'Continue to voting' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to voting' }))
    expect(ctx.act).toHaveBeenCalledWith('start_phase', { p_board: 'b1', p_phase: 'vote' })
  })

  it('steps to the next card, and is done on the last', () => {
    const ctx = makeCtx({ state: pitching('t1'), topics })
    const { rerender } = render(<Clarify ctx={ctx} remaining={20_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next pitch' }))
    expect(ctx.act).toHaveBeenCalledWith('set_pitch', { p_board: 'b1', p_topic: 't2' })
    rerender(<Clarify ctx={makeCtx({ state: pitching('t2'), topics })} remaining={20_000} />)
    expect(screen.getByRole('button', { name: 'Last pitch done' })).toBeDisabled()
  })

  it('starts with the first card', () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start pitches' }))
    expect(ctx.act).toHaveBeenCalledWith('set_pitch', { p_board: 'b1', p_topic: 't1' })
  })

  it('has no clock when the pitch timer is off', () => {
    render(
      <Clarify
        ctx={makeCtx({
          state: { ...clarify, pitch_topic_id: 't1' },
          settings: { pitch_s: 0 },
          topics,
        })}
        remaining={null}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One')
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })
})

describe('Clarify skip pitches', () => {
  it('goes straight to voting when the cards already speak for themselves', () => {
    const ctx = makeCtx({ state: clarify, topics: [topic('t1', 'One')] })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip pitches' }))
    expect(ctx.act).toHaveBeenCalledWith('start_phase', { p_board: 'b1', p_phase: 'vote' })
  })

  it('is replaced by Stop pitching once pitches start, and Delete leaves the pitched card', () => {
    const state = { phase: 'clarify' as const, pitch_topic_id: 't1' }
    const topics = [topic('t1', 'One'), topic('t2', 'Two')]
    const ctx = makeCtx({ state, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    expect(screen.queryByRole('button', { name: 'Skip pitches' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop pitching' }))
    expect(ctx.act).toHaveBeenCalledWith('set_pitch', { p_board: 'b1', p_topic: null })
    expect(screen.getAllByRole('button', { name: /^Delete "/ })).toHaveLength(1)
  })

  it('says so when nobody added a topic, and still offers voting', () => {
    const ctx = makeCtx({ state: clarify })
    render(<Clarify ctx={ctx} remaining={null} />)
    expect(stage()).toHaveTextContent('Nobody added a topic. Continue to voting')
    expect(screen.queryByRole('button', { name: 'Start pitches' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to voting' }))
    expect(ctx.act).toHaveBeenCalledWith('start_phase', { p_board: 'b1', p_phase: 'vote' })
  })
})
