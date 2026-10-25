import { fireEvent, render, screen, within } from '@testing-library/react'
import { makeCtx } from '../../test/boardContext'
import { InviteButton, inviteMessage } from './Invite'

describe('inviteMessage', () => {
  it('puts the name, link and code on separate lines', () => {
    expect(inviteMessage('Team sync', 'KQ74-M2X9', false)).toBe(
      `Join our Lean Coffee: Team sync\n${window.location.origin}/b/KQ74-M2X9\nRoom code: KQ74-M2X9`,
    )
  })

  it('leaves out a blank name and mentions a passcode without revealing it', () => {
    const text = inviteMessage('', 'KQ74-M2X9', true)
    expect(text.split('\n')[0]).toBe('Join our Lean Coffee')
    expect(text).toContain('Ask the facilitator for the passcode.')
  })
})

describe('InviteButton', () => {
  it('opens a dialog with the code and both copy buttons', () => {
    render(<InviteButton ctx={makeCtx({ state: { phase: 'brainstorm' } })} />)
    fireEvent.click(screen.getByRole('button', { name: /Invite people, room code/ }))
    const dialog = screen.getByRole('dialog', { name: 'Invite people' })
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy invite message' })).toBeInTheDocument()
    expect(within(dialog).queryByText(/The board is locked/)).toBeNull()
  })

  it('warns when the board is locked', () => {
    render(<InviteButton ctx={makeCtx({ state: { phase: 'discuss', locked: true } })} />)
    fireEvent.click(screen.getByRole('button', { name: /Invite people/ }))
    expect(screen.getByText(/The board is locked/)).toBeInTheDocument()
  })
})
