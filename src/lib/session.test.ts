import type { BoardState, Topic, Vote } from './types'
import {
  dotTotals,
  extendOutcome,
  myDotsUsed,
  tieGroups,
  topicsThatFit,
  sessionMinutesLeft,
} from './session'

const topic = (id: string): Topic => ({
  id,
  board_id: 'b',
  author_user_id: 'u',
  author_name: 'A',
  text: id,
  status: 'open',
  merged_into: null,
  sort_order: 0,
  time_spent_ms: 0,
  extensions: 0,
  discussed_seq: null,
  created_at: '',
})
const vote = (topic_id: string, user_id: string, dots: number, round = 0): Vote => ({
  id: `${topic_id}${user_id}${round}`,
  board_id: 'b',
  topic_id,
  user_id,
  round,
  dots,
})

describe('extend rule', () => {
  // Every combination up to 4 voters: Keep must strictly beat Move on; Neutral never counts.
  for (let keep = 0; keep <= 4; keep++)
    for (let neutral = 0; neutral <= 4 - keep; neutral++)
      for (let moveOn = 0; moveOn <= 4 - keep - neutral; moveOn++) {
        const want = keep > moveOn ? 'extend' : 'move_on'
        it(`keep ${keep}, neutral ${neutral}, move on ${moveOn} -> ${want}`, () => {
          expect(extendOutcome(keep, moveOn)).toBe(want)
        })
      }
})

describe('dots', () => {
  const votes = [vote('a', 'u1', 2), vote('b', 'u1', 1), vote('a', 'u2', 3), vote('a', 'u1', 1, 1)]
  it('totals per topic for one round', () => {
    expect(Object.fromEntries(dotTotals(votes, 0))).toEqual({ a: 5, b: 1 })
  })
  it('counts a user’s dots in one round only', () => {
    expect(myDotsUsed(votes, 'u1', 0)).toBe(3)
    expect(myDotsUsed(votes, 'u1', 1)).toBe(1)
  })
})

describe('tie groups', () => {
  it('groups open topics with equal totals', () => {
    const totals = new Map([
      ['a', 3],
      ['b', 3],
      ['c', 1],
      ['d', 0],
      ['e', 0],
    ])
    const groups = tieGroups(['a', 'b', 'c', 'd', 'e'].map(topic), totals)
    expect(groups.map((g) => g.map((t) => t.id))).toEqual([
      ['a', 'b'],
      ['d', 'e'],
    ])
  })
})

describe('topics we can still fit', () => {
  it('reserves wrap-up and counts whole timeboxes', () => {
    expect(topicsThatFit(41, 300, 300)).toBe(7)
    expect(topicsThatFit(4, 300, 300)).toBe(0)
  })
  it('measures minutes left from the brainstorm start', () => {
    const state = { started_at: '2026-10-25T10:00:00Z', planned_minutes: 75 } as BoardState
    expect(sessionMinutesLeft(state, Date.parse('2026-10-25T10:34:00Z'))).toBe(41)
  })
})
