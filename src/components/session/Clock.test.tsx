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

  it('turns urgent later on a short clock, such as a 30 s tie-break', () => {
    const { rerender } = render(
      <RingTimer remaining={25_000} totalMs={30_000} paused={false} size={200} urgentMs={10_000} />,
    )
    expect(screen.getByText('of 0:30')).toBeInTheDocument()
    expect(digits()).toHaveClass('text-ink')
    rerender(
      <RingTimer remaining={9_000} totalMs={30_000} paused={false} size={200} urgentMs={10_000} />,
    )
    // The digits keep counting down, so the label does not name a number of seconds left.
    expect(screen.getByText('Under 10 s')).toBeInTheDocument()
    expect(digits()).toHaveClass('text-urgent')
  })

  it('says the minute marks politely, without interrupting', () => {
    const { rerender, container } = render(
      <RingTimer remaining={61_000} totalMs={300_000} paused={false} size={200} />,
    )
    rerender(<RingTimer remaining={59_000} totalMs={300_000} paused={false} size={200} />)
    const line = container.querySelector('[aria-live]')
    expect(line).toHaveAttribute('aria-live', 'polite')
    expect(line).toHaveTextContent('1 minute left')
  })
})
