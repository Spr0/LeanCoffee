import { fireEvent, render, screen, within } from '@testing-library/react'
import { makeCtx, person } from '../../test/boardContext'
import { PeopleButton, PeoplePanel } from './People'

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

describe('PeopleButton: the Discuss toolbar', () => {
  it('counts the people connected and opens the panel in a dialog', () => {
    const away = new Date(Date.now() - 600_000).toISOString()
    const participants = [person('u1', 'Fran'), person('u2', 'Pat'), person('u3', 'Quinn', away)]
    render(<PeopleButton ctx={makeCtx({ state: { phase: 'discuss' }, participants })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 people' }))
    const dialog = screen.getByRole('dialog', { name: 'People' })
    expect(within(dialog).getByRole('list', { name: 'People connected' })).not.toHaveTextContent(
      'Quinn',
    )
    expect(within(dialog).getByRole('button', { name: 'Pass facilitator role' })).toBeEnabled()
    // The panel inside the dialog does not repeat the toolbar's announcement.
    expect(within(dialog).queryByRole('status')).toBeNull()
  })

  it('shows and announces a reconnecting facilitator while the dialog is closed', () => {
    const participants = [person('u1', 'Fran', twoMinutesAgo), person('u2', 'Pat')]
    render(
      <PeopleButton ctx={makeCtx({ userId: 'u2', state: { phase: 'discuss' }, participants })} />,
    )
    const shown = (_: string, el: Element | null) =>
      el?.textContent === 'Facilitator Fran (reconnecting)'
    expect(screen.getByText(shown)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('The facilitator, Fran, is reconnecting.')
    expect(screen.getByRole('button', { name: '1 person' })).toBeInTheDocument()
  })
})
