import { render, screen } from '@testing-library/react'
import { RingTimer } from './Clock'

const digits = () => screen.getByText(/^\d+:\d\d$/)

describe('RingTimer', () => {
  it('keeps 72 px digits in the 220 px stage ring', () => {
    render(<RingTimer remaining={222_000} totalMs={300_000} paused={false} size={220} />)
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
    // At 72 px the corners of 7:47 or 1:27 reach 86 px from the centre, past a 200 px ring's
    // inner edge at 83 px.
    rerender(<RingTimer remaining={467_000} totalMs={600_000} paused={false} size={200} />)
    expect(digits()).toHaveClass('text-[64px]')
  })

  it('grows the ring to fit the clock shown, whatever size is passed', () => {
    const { rerender } = render(
      <RingTimer remaining={632_000} totalMs={632_000} paused={false} size={200} />,
    )
    expect(digits()).toHaveTextContent('10:32')
    expect(screen.getByRole('timer')).toHaveStyle({ width: '240px', height: '240px' })
    expect(digits()).toHaveClass('text-[64px]')
    rerender(<RingTimer remaining={599_000} totalMs={632_000} paused={false} size={200} />)
    expect(screen.getByRole('timer')).toHaveStyle({ width: '200px', height: '200px' })
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

  it('keeps the length once time added takes the clock past its setting', () => {
    const ring = (remaining: number) => (
      <RingTimer
        remaining={remaining}
        totalMs={Math.max(remaining, 360_000)}
        paused={false}
        size={240}
      />
    )
    const { rerender } = render(ring(300_000))
    expect(screen.getByText('of 6:00')).toBeInTheDocument()
    rerender(ring(652_000))
    rerender(ring(651_000))
    rerender(ring(650_000))
    expect(screen.getByText('of 10:52')).toBeInTheDocument()
    rerender(ring(200_000))
    expect(screen.getByText('of 10:52')).toBeInTheDocument()
    // A new clock at the set length starts over.
    rerender(ring(10_000))
    rerender(ring(360_000))
    expect(screen.getByText('of 6:00')).toBeInTheDocument()
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

  it('says a mark again when the clock crosses it again after time is added', () => {
    const ring = (remaining: number) => (
      <RingTimer remaining={remaining} totalMs={300_000} paused={false} size={220} />
    )
    const { rerender, container } = render(ring(61_000))
    rerender(ring(54_000))
    const line = container.querySelector('[aria-live]')
    const first = line?.firstElementChild
    expect(line).toHaveTextContent('1 minute left')
    // Added time clears the line, so a running clock never sits beside an old message.
    rerender(ring(112_000))
    expect(line).toHaveTextContent('')
    rerender(ring(52_000))
    expect(line).toHaveTextContent('1 minute left')
    // A new node, so a screen reader says it again.
    expect(line?.firstElementChild).not.toBe(first)
  })

  it('clears "Time\'s up" when a new clock starts', () => {
    const ring = (remaining: number) => (
      <RingTimer remaining={remaining} totalMs={30_000} paused={false} size={200} />
    )
    const { rerender, container } = render(ring(1_000))
    rerender(ring(0))
    const line = container.querySelector('[aria-live]')
    expect(line).toHaveTextContent("Time's up")
    rerender(ring(30_000))
    rerender(ring(27_000))
    expect(line).toHaveTextContent('')
    rerender(ring(0))
    expect(line).toHaveTextContent("Time's up")
  })
})
