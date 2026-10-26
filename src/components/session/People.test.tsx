import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeCtx, person } from '../../test/boardContext'
import { byJoin, PeopleButton, PeoplePanel } from './People'

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
    // Another tab, or a second press, that ended it first is not an error to show.
    expect(ctx.act).toHaveBeenCalledWith(
      'end_session',
      { p_board: 'b1' },
      { quiet: ['invalid_phase_order'] },
    )
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
    // The panel inside the dialog does not repeat the toolbar's announcement; the dialog's own
    // live line only repeats what the board says after it opened.
    expect(within(dialog).getByRole('status').textContent).toBe('')
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

describe('PeoplePanel: managing people', () => {
  const three = [person('u1', 'Fran'), person('u2', 'Pat'), person('u3', 'Quinn')]
  const openManage = (ctx = makeCtx({ state: { phase: 'discuss' }, participants: three })) => {
    render(<PeoplePanel ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
    return { ctx, dialog: screen.getByRole('dialog', { name: 'People on this board' }) }
  }

  it('opens on its title, so a second Enter presses nothing', () => {
    const { dialog } = openManage()
    expect(within(dialog).getByRole('heading', { name: 'People on this board' })).toHaveFocus()
  })

  it('names who each Remove removes, and asks before removing', async () => {
    const { ctx, dialog } = openManage()
    expect(within(dialog).getByText('You')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Pat' }))
    expect(ctx.act).not.toHaveBeenCalled()
    const ask = within(dialog).getByRole('group', { name: 'Remove Pat?' })
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Remove Pat' })).toHaveFocus()
    expect(ctx.act).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Pat' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Pat' }))
    await waitFor(() =>
      expect(ctx.act).toHaveBeenCalledWith('remove_participant', { p_board: 'b1', p_user: 'u2' }),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'People on this board' })).toHaveFocus(),
    )
  })

  it('says why the board creator has no Remove when someone else facilitates', () => {
    const ctx = makeCtx({
      userId: 'u2',
      state: { phase: 'discuss', facilitator_user_id: 'u2' },
      participants: three,
    })
    const { dialog } = openManage(ctx)
    expect(within(dialog).getByText('Board creator')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove Quinn' })).toBeInTheDocument()
  })

  it('closes for good when the facilitator role moves away (security)', () => {
    const ctx = makeCtx({ state: { phase: 'discuss' }, participants: three })
    const { rerender } = render(<PeoplePanel ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
    expect(screen.getByRole('switch', { name: 'Lock the board' })).toBeInTheDocument()
    const taken = {
      ...ctx,
      isFacilitator: false,
      state: { ...ctx.state, facilitator_user_id: 'u2' },
    }
    rerender(<PeoplePanel ctx={taken} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body).not.toHaveTextContent('Lock the board')
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    rerender(<PeoplePanel ctx={ctx} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('holds no facilitator controls in a participant page, even closed', () => {
    render(
      <PeoplePanel
        ctx={makeCtx({ userId: 'u2', state: { phase: 'discuss' }, participants: three })}
      />,
    )
    for (const text of ['Lock the board', 'Close topic submissions', 'Pass to'])
      expect(document.body).not.toHaveTextContent(text)
    expect(document.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(0)
  })

  it('says the sound state in words only', () => {
    render(<PeoplePanel ctx={makeCtx({ state: { phase: 'discuss' } })} />)
    const sound = screen.getByRole('button', { name: /^Sound (on|off)$/ })
    expect(sound).not.toHaveAttribute('aria-pressed')
    const before = sound.textContent
    act(() => sound.click())
    expect(sound.textContent).not.toBe(before)
    act(() => sound.click())
  })
})

describe('byJoin', () => {
  it('puts the facilitator first, then everyone in the order they joined', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 26, 9, 0, s)).toISOString()
    const people = [
      { ...person('u3', 'Di'), joined_at: at(3) },
      { ...person('u2', 'Bo'), joined_at: at(1) },
      { ...person('u1', 'Fran'), joined_at: at(0) },
      { ...person('u4', 'Cy'), joined_at: at(2) },
    ]
    expect(byJoin(people, 'u3').map((p) => p.display_name)).toEqual(['Di', 'Fran', 'Bo', 'Cy'])
  })
})
