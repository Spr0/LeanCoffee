import { topic } from '../../test/boardContext'
import { clarifyMoves } from './ClarifyMoves'

const a = topic('t1', 'Code review turnaround')
const b = topic('t2', 'Flaky tests')
const c = topic('t3', 'Release notes', 'u1')
const into = (t: typeof a, target: string | null) => ({ ...t, merged_into: target })

describe('clarifyMoves', () => {
  it('says nothing when nothing moved', () => {
    expect(clarifyMoves({ topics: [a, b], pitch: null }, { topics: [a, b], pitch: null })).toBe('')
  })

  it('names a merge and an undone merge', () => {
    const merged = { topics: [a, into(b, 't1')], pitch: null }
    expect(clarifyMoves({ topics: [a, b], pitch: null }, merged)).toBe(
      '"Flaky tests" was merged into "Code review turnaround".',
    )
    expect(clarifyMoves(merged, { topics: [a, b], pitch: null })).toBe(
      '"Flaky tests" is a card of its own again.',
    )
  })

  it('names only the card merged, not the cards it carries along', () => {
    // Merging Flaky tests (with Release notes on it) into Code review moves both.
    const before = { topics: [a, b, into(c, 't2')], pitch: null }
    const after = { topics: [a, into(b, 't1'), into(c, 't1')], pitch: null }
    expect(clarifyMoves(before, after)).toBe(
      '"Flaky tests" was merged into "Code review turnaround".',
    )
  })

  it('names a deleted card once, not the cards deleted with it', () => {
    const before = { topics: [a, b, into(c, 't2')], pitch: null }
    expect(clarifyMoves(before, { topics: [a, b], pitch: null })).toBe('')
    expect(clarifyMoves({ topics: [a, b], pitch: null }, { topics: [a], pitch: null })).toBe(
      '"Flaky tests" was deleted.',
    )
  })

  it('names who pitches next, and when pitches stop', () => {
    const before = { topics: [a, b], pitch: null }
    const first = { topics: [a, b], pitch: 't1' }
    const second = { topics: [a, b], pitch: 't2' }
    expect(clarifyMoves(before, first)).toBe('Pat is pitching "Code review turnaround".')
    expect(clarifyMoves(first, second)).toBe('Pat is pitching "Flaky tests".')
    expect(clarifyMoves(second, before)).toBe('Pitches stopped.')
  })

  it('joins what changed together into one line', () => {
    expect(
      clarifyMoves({ topics: [a, b, c], pitch: 't1' }, { topics: [a, into(b, 't1')], pitch: null }),
    ).toBe(
      '"Flaky tests" was merged into "Code review turnaround". "Release notes" was deleted. Pitches stopped.',
    )
  })
})
