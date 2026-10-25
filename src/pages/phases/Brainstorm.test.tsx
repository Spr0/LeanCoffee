import { fireEvent, render, screen } from '@testing-library/react'
import { makeCtx, topic } from '../../test/boardContext'
import Brainstorm from './Brainstorm'

// Closing the phase at zero calls the server; nothing here reaches zero.
vi.mock('../../lib/retry', () => ({ callWhenDue: vi.fn() }))

const stopped = { phase: 'brainstorm' as const, paused_remaining_ms: 300_000 }
const running = {
  phase: 'brainstorm' as const,
  phase_ends_at: new Date(Date.now() + 200_000).toISOString(),
}

describe('Brainstorm clock (decision D64)', () => {
  it('gives the facilitator a start button while the clock has never run', () => {
    const ctx = makeCtx({ state: stopped })
    render(<Brainstorm ctx={ctx} remaining={300_000} />)
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    expect(screen.queryByText('PAUSED')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start the 5:00 clock' }))
    expect(ctx.act).toHaveBeenCalledWith('timer_resume', { p_board: 'b1' })
    expect(screen.getByRole('button', { name: 'End brainstorm now' })).toBeEnabled()
  })

  it('tells participants the clock has not started yet', () => {
    render(<Brainstorm ctx={makeCtx({ userId: 'u2', state: stopped })} remaining={300_000} />)
    expect(screen.getByText('The clock starts when the facilitator is ready.')).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.queryByRole('button', { name: /Start the/ })).toBeNull()
  })

  it('announces the start once to participants who saw it stopped', () => {
    const { rerender } = render(
      <Brainstorm ctx={makeCtx({ userId: 'u2', state: stopped })} remaining={300_000} />,
    )
    rerender(<Brainstorm ctx={makeCtx({ userId: 'u2', state: running })} remaining={200_000} />)
    expect(screen.getByText('The clock has started.')).toHaveAttribute('role', 'status')
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
    expect(screen.getByText('PAUSED')).toBeInTheDocument()
  })
})

describe('Brainstorm topic editing', () => {
  it('shows a character counter while editing a topic', () => {
    const ctx = makeCtx({ state: running, topics: [topic('t1', 'Retro cadence', 'u1')] })
    render(<Brainstorm ctx={ctx} remaining={200_000} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Retro cadence"' }))
    const input = screen.getByRole('textbox', { name: 'Edit topic' })
    expect(input).toHaveAccessibleDescription('13 of 160 characters')
    fireEvent.change(input, { target: { value: 'Retro' } })
    expect(screen.getByText('5 of 160 characters')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Edit topic' })).toBeNull()
  })
})
