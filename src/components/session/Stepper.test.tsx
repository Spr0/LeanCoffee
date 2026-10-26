import { render, screen } from '@testing-library/react'
import { makeCtx, topic } from '../../test/boardContext'
import { PhaseStepper, reachedPhase } from './Stepper'

const done = () =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.textContent?.includes('(done)'))
    .map((li) => li.textContent?.replace(/\(done\).*/, '').trim())

describe('PhaseStepper', () => {
  it('ticks the steps before the current one and names the current hint', () => {
    const { state } = makeCtx({ state: { phase: 'vote' } })
    render(<PhaseStepper state={state} currentHint="1:29 paused" />)
    expect(done()).toEqual(['Brainstorm', 'Clarify'])
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('1:29 paused')
  })

  it('on an ended board ticks only the phases the session reached', () => {
    const { state } = makeCtx({ state: { phase: 'ended' } })
    const { rerender } = render(<PhaseStepper state={state} reached="lobby" />)
    expect(done()).toEqual([])
    rerender(<PhaseStepper state={state} reached="brainstorm" />)
    expect(done()).toEqual(['Brainstorm'])
    rerender(<PhaseStepper state={state} reached="wrapup" />)
    expect(done()).toEqual(['Brainstorm', 'Clarify', 'Vote', 'Discuss', 'Wrap-up'])
  })
})

describe('reachedPhase', () => {
  const at = '2026-10-26T09:00:00Z'
  it('reads how far the session got from the board', () => {
    const none = { started_at: null, votes_revealed_at: null }
    expect(reachedPhase(none, [], 0, 'lobby')).toBe('lobby')
    expect(reachedPhase({ ...none, started_at: at }, [topic('t1', 'A')], 0, 'lobby')).toBe(
      'brainstorm',
    )
    const revealed = { started_at: at, votes_revealed_at: at }
    expect(reachedPhase(revealed, [topic('t1', 'A')], 0, 'lobby')).toBe('vote')
    expect(
      reachedPhase(revealed, [topic('t1', 'A', 'u2', { status: 'skipped' })], 0, 'lobby'),
    ).toBe('discuss')
    expect(
      reachedPhase(revealed, [topic('t1', 'A', 'u2', { time_spent_ms: 4000 })], 0, 'lobby'),
    ).toBe('discuss')
    expect(reachedPhase(revealed, [], 2, 'lobby')).toBe('wrapup')
  })

  it('trusts the phase this tab saw before the end when the board cannot show it', () => {
    const revealed = { started_at: '2026-10-26T09:00:00Z', votes_revealed_at: at }
    expect(reachedPhase(revealed, [], 0, 'wrapup')).toBe('wrapup')
    expect(reachedPhase({ started_at: at, votes_revealed_at: null }, [], 0, 'clarify')).toBe(
      'clarify',
    )
  })
})
