import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Dialog } from './Dialog'

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
})
