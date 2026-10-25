import { fireEvent, render, screen, within } from '@testing-library/react'
import { makeCtx, person } from '../../test/boardContext'
import { PeoplePanel } from './People'

const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString()
const minuteAgo = new Date(Date.now() - 60_000).toISOString()

describe('PeoplePanel: facilitator reconnecting (spec section 8)', () => {
  it('shows and announces when the facilitator has gone quiet', () => {
    const participants = [person('u1', 'Fran', twoMinutesAgo), person('u2', 'Pat')]
    render(<PeoplePanel ctx={makeCtx({ userId: 'u2', state: { phase: 'vote' }, participants })} />)
    expect(screen.getByText('(reconnecting)')).toBeInTheDocument()
    expect(screen.getByText('The facilitator, Fran, is reconnecting.')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('waits out a slow heartbeat from a background tab', () => {
    const participants = [person('u1', 'Fran', minuteAgo), person('u2', 'Pat')]
    render(<PeoplePanel ctx={makeCtx({ userId: 'u2', state: { phase: 'vote' }, participants })} />)
    expect(screen.queryByText('(reconnecting)')).toBeNull()
  })

  it('says nothing once the session has ended', () => {
    const participants = [person('u1', 'Fran', twoMinutesAgo), person('u2', 'Pat')]
    render(<PeoplePanel ctx={makeCtx({ userId: 'u2', state: { phase: 'ended' }, participants })} />)
    expect(screen.queryByText('(reconnecting)')).toBeNull()
  })

  it('says nothing while the facilitator is connected', () => {
    render(<PeoplePanel ctx={makeCtx({ userId: 'u2', state: { phase: 'vote' } })} />)
    expect(screen.queryByText('(reconnecting)')).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})

describe('PeoplePanel: end session any time (spec F25)', () => {
  it('asks the facilitator to confirm, then ends the session', () => {
    const ctx = makeCtx({ state: { phase: 'clarify' } })
    render(<PeoplePanel ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('dialog', { name: 'End the session now?' })
    expect(dialog).toHaveTextContent(
      'The board becomes read-only for everyone. Downloads stay available.',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(ctx.act).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    fireEvent.click(screen.getByRole('button', { name: 'End session now' }))
    expect(ctx.act).toHaveBeenCalledWith('end_session', { p_board: 'b1' })
  })

  it('leaves Wrap-up to its own End session button', () => {
    render(<PeoplePanel ctx={makeCtx({ state: { phase: 'wrapup' } })} />)
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })

  it('is not offered to participants', () => {
    render(<PeoplePanel ctx={makeCtx({ userId: 'u2', state: { phase: 'discuss' } })} />)
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull()
  })
})
