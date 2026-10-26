import type { Vote } from '../../lib/types'
import { makeTopic } from './testBoard'
import { agendaTies, voteCounts } from './VoteRanking'

const dot = (topic_id: string, user_id: string, round: number, dots = 1): Vote => ({
  id: `${topic_id}${user_id}${round}`,
  board_id: 'b1',
  topic_id,
  user_id,
  round,
  dots,
})

describe('voteCounts', () => {
  const votes = [dot('a', 'u1', 0, 2), dot('a', 'u2', 0), dot('b', 'u1', 0), dot('b', 'u1', 1)]

  it('shows nothing while the main round is being voted on', () => {
    // Before the reveal the rows returned are the user's own: they are not totals.
    expect(
      voteCounts([dot('a', 'u1', 0, 2)], { base_round: 0, vote_round: 0, votes_revealed_at: null }),
    ).toBeNull()
  })

  it('totals the main round once revealed', () => {
    const counts = voteCounts(votes.slice(0, 3), {
      base_round: 0,
      vote_round: 0,
      votes_revealed_at: 'now',
    })
    expect(counts?.main).toEqual(
      new Map([
        ['a', 3],
        ['b', 1],
      ]),
    )
    expect(counts?.tie.size).toBe(0)
  })

  it('keeps the main round during a tie-break, without the open tie-break round', () => {
    const counts = voteCounts(votes, { base_round: 0, vote_round: 1, votes_revealed_at: null })
    expect(counts?.main.get('a')).toBe(3)
    expect(counts?.tie.size).toBe(0)
  })

  it('adds tie-break rounds once they are revealed', () => {
    const counts = voteCounts(votes, { base_round: 0, vote_round: 1, votes_revealed_at: 'now' })
    expect(counts?.tie).toEqual(new Map([['b', 1]]))
  })

  it('leaves out rounds before a re-vote', () => {
    const counts = voteCounts([...votes, dot('c', 'u1', 2)], {
      base_round: 2,
      vote_round: 2,
      votes_revealed_at: 'now',
    })
    expect(counts?.main).toEqual(new Map([['c', 1]]))
    expect(counts?.tie.size).toBe(0)
  })
})

describe('agendaTies', () => {
  const open = ['a', 'b', 'c', 'd'].map((id, i) => makeTopic(id, id, 'open', i))

  it('groups topics whose main and tie-break totals both match, in agenda order', () => {
    const counts = {
      main: new Map([
        ['a', 3],
        ['b', 2],
        ['c', 2],
        ['d', 2],
      ]),
      tie: new Map([['d', 1]]),
    }
    expect(agendaTies(open, counts).map((g) => g.map((t) => t.id))).toEqual([['b', 'c']])
  })

  it('counts topics without dots as tied with each other', () => {
    const counts = { main: new Map([['a', 1]]), tie: new Map() }
    expect(agendaTies(open, counts).map((g) => g.map((t) => t.id))).toEqual([['b', 'c', 'd']])
  })
})
