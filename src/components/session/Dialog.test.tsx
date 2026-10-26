import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Dialog, echoError, echoStatus } from './Dialog'

function Nested({ onOuterClose }: { onOuterClose: () => void }) {
  const [inner, setInner] = useState(true)
  return (
    <Dialog open onClose={onOuterClose} title="Outer">
      <Dialog open={inner} onClose={() => setInner(false)} title="Inner">
        <button type="button" onClick={() => setInner(false)}>
          Close inner
        </button>
      </Dialog>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('stays open when a dialog opened inside it closes', () => {
    const onOuterClose = vi.fn()
    render(<Nested onOuterClose={onOuterClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close inner' }))
    expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument()
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('opens on its title, with its content mounted only while open', () => {
    const { rerender } = render(
      <Dialog open={false} onClose={() => {}} title="People">
        <button type="button">Remove Pat</button>
      </Dialog>,
    )
    expect(document.body).not.toHaveTextContent('Remove Pat')
    rerender(
      <Dialog open onClose={() => {}} title="People">
        <button type="button">Remove Pat</button>
      </Dialog>,
    )
    expect(screen.getByRole('heading', { name: 'People' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Remove Pat' })).toBeInTheDocument()
  })

  it('repeats what the board says after it opened, since the page behind it is inert', () => {
    act(() => echoStatus('Before it opened'))
    render(
      <Dialog open onClose={() => {}} title="Downloads">
        <p>Files</p>
      </Dialog>,
    )
    const line = screen.getByRole('status')
    expect(line.textContent).toBe('')
    act(() => echoStatus("Time's up"))
    expect(line).toHaveTextContent("Time's up")
    act(() => echoError('Only the facilitator can do that.'))
    expect(screen.getByRole('alert')).toHaveTextContent('Only the facilitator can do that.')
    act(() => echoError(null))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
