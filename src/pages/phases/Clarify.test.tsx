import { fireEvent, render, screen, within } from '@testing-library/react'
import { makeCtx, topic } from '../../test/boardContext'
import Clarify from './Clarify'

// jsdom has no modal dialogs; open and close by attribute.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

const NINE = Array.from({ length: 9 }, (_, i) => topic(`t${i + 1}`, `Topic ${i + 1}`))
const clarify = { phase: 'clarify' as const }

describe('Clarify dots suggestion (spec section 3)', () => {
  it('suggests topics / 2, at most 5, and applies it', () => {
    const ctx = makeCtx({ state: clarify, topics: NINE })
    render(<Clarify ctx={ctx} remaining={null} />)
    expect(screen.getByText('Suggested: 5 dots each (topics / 2, at most 5)')).toBeInTheDocument()
    expect(screen.getByText('3 each')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use 5 dots' }))
    expect(ctx.act).toHaveBeenCalledWith('update_settings', {
      p_board: 'b1',
      p_settings: { dots: 5 },
    })
  })

  it('counts merged cards once and hides the button when it already matches', () => {
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
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
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
  })
})

describe('Clarify facilitator edit and delete', () => {
  const topics = [topic('t1', 'Code review turnaround'), topic('t2', 'Retro cadence')]

  it('keeps the card button the only one named after the topic', () => {
    render(<Clarify ctx={makeCtx({ state: clarify, topics })} remaining={null} />)
    expect(screen.getAllByRole('button', { name: /Code review turnaround/ })).toHaveLength(1)
    const edits = screen.getAllByRole('button', { name: 'Edit' })
    expect(edits[0]).toHaveAccessibleDescription('Code review turnaround')
  })

  it('edits a topic inline with a counter, and Escape cancels', () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement)
    const box = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(box).toHaveFocus()
    expect(box).toHaveAccessibleDescription('13 of 160 characters')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
    expect(ctx.act).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1] as HTMLElement)
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

  it('asks before deleting a topic', () => {
    const ctx = makeCtx({ state: clarify, topics })
    render(<Clarify ctx={ctx} remaining={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0] as HTMLElement)
    const dialog = screen.getByRole('dialog', { name: 'Delete this topic?' })
    expect(dialog).toHaveTextContent('"Code review turnaround" by Pat is removed for everyone.')
    expect(ctx.act).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete topic' }))
    expect(ctx.act).toHaveBeenCalledWith('delete_topic', { p_topic: 't1' })
  })

  it('gives participants no edit or delete controls', () => {
    render(<Clarify ctx={makeCtx({ userId: 'u2', state: clarify, topics })} remaining={null} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})

describe('Clarify pitch timer', () => {
  it('gives the facilitator timer buttons while a pitch clock runs', () => {
    const state = {
      phase: 'clarify' as const,
      pitch_topic_id: 't1',
      phase_ends_at: new Date(Date.now() + 20_000).toISOString(),
    }
    const ctx = makeCtx({ state, topics: [topic('t1', 'One')] })
    render(<Clarify ctx={ctx} remaining={20_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove 15 seconds' }))
    expect(ctx.act).toHaveBeenCalledWith('timer_adjust', { p_board: 'b1', p_delta_s: -15 })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })
})
