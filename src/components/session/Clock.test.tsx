import { render, screen } from '@testing-library/react'
import { RingTimer } from './Clock'

const digits = () => screen.getByText(/^\d+:\d\d$/)

describe('RingTimer', () => {
  it('keeps 72 px digits in the stage rings', () => {
    render(<RingTimer remaining={222_000} totalMs={300_000} paused={false} size={200} />)
    expect(digits()).toHaveClass('text-[72px]')
    expect(screen.getByRole('timer')).toHaveAccessibleName('3 minutes 42 seconds left')
  })

  it('drops to 64 px where 72 px would cross the stroke', () => {
    const { rerender } = render(
      <RingTimer remaining={600_000} totalMs={600_000} paused={false} size={240} />,
    )
    expect(digits()).toHaveTextContent('10:00')
    expect(digits()).toHaveClass('text-[64px]')
    rerender(<RingTimer remaining={600_000} totalMs={600_000} paused={false} size={260} />)
    expect(digits()).toHaveClass('text-[72px]')
    rerender(<RingTimer remaining={222_000} totalMs={300_000} paused={false} size={180} />)
    expect(digits()).toHaveClass('text-[64px]')
  })

  it('says it in words as well as color at a minute left', () => {
    render(<RingTimer remaining={45_000} totalMs={300_000} paused={false} size={220} />)
    expect(screen.getByText('1 min left')).toBeInTheDocument()
  })
})
