import { render, screen } from '@testing-library/react'
import type { Phase } from '../lib/types'
import { usePhaseFocus } from './usePhaseFocus'

/** A board whose main content swaps with the phase, as SessionShell does. */
function Board({ phase }: { phase: Phase }) {
  usePhaseFocus(phase)
  return (
    <>
      <header>
        <button type="button">Invite</button>
      </header>
      {phase === 'clarify' ? (
        <main>
          <h1 tabIndex={-1}>Here is everything the group wrote</h1>
          <button type="button">Skip pitches</button>
        </main>
      ) : (
        <main>
          <h1 tabIndex={-1}>Spend your 3 dots</h1>
        </main>
      )}
    </>
  )
}

describe('usePhaseFocus', () => {
  it('moves focus to the new heading when the pressed control left with the old phase', () => {
    const { rerender } = render(<Board phase="clarify" />)
    screen.getByRole('button', { name: 'Skip pitches' }).focus()
    rerender(<Board phase="vote" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('leaves focus alone when it was not in the main content', () => {
    const { rerender } = render(<Board phase="clarify" />)
    const invite = screen.getByRole('button', { name: 'Invite' })
    invite.focus()
    rerender(<Board phase="vote" />)
    expect(invite).toHaveFocus()
    invite.blur()
    rerender(<Board phase="discuss" />)
    expect(document.body).toHaveFocus()
  })
})
