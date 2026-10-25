import { fireEvent, render, screen } from '@testing-library/react'
import { makeCtx } from '../../test/boardContext'
import { TimerButtons } from './common'

const running = {
  phase: 'vote' as const,
  phase_ends_at: new Date(Date.now() + 60_000).toISOString(),
}

describe('TimerButtons', () => {
  it('shows nothing when no timer is set', () => {
    const { container } = render(<TimerButtons ctx={makeCtx({ state: { phase: 'vote' } })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('pauses, removes and adds a minute (spec F17)', () => {
    const ctx = makeCtx({ state: running })
    render(<TimerButtons ctx={ctx} />)
    expect(screen.getByRole('button', { name: 'Remove 1 minute' })).toHaveTextContent('-1 min')
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1 minute' }))
    expect(ctx.act).toHaveBeenLastCalledWith('timer_adjust', { p_board: 'b1', p_delta_s: -60 })
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 minute' }))
    expect(ctx.act).toHaveBeenLastCalledWith('timer_adjust', { p_board: 'b1', p_delta_s: 60 })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(ctx.act).toHaveBeenLastCalledWith('timer_pause', { p_board: 'b1' })
  })

  it('uses the same step both ways, and resumes a paused clock', () => {
    const ctx = makeCtx({ state: { phase: 'vote', paused_remaining_ms: 45_000 } })
    render(<TimerButtons ctx={ctx} addSeconds={30} />)
    expect(screen.getByRole('button', { name: 'Remove 30 seconds' })).toHaveTextContent('-30 s')
    expect(screen.getByRole('button', { name: 'Add 30 seconds' })).toHaveTextContent('+30 s')
    fireEvent.click(screen.getByRole('button', { name: 'Remove 30 seconds' }))
    expect(ctx.act).toHaveBeenLastCalledWith('timer_adjust', { p_board: 'b1', p_delta_s: -30 })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(ctx.act).toHaveBeenLastCalledWith('timer_resume', { p_board: 'b1' })
  })
})
