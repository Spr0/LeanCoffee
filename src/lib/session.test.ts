import type { BoardState, ExtendRound, Topic, Vote } from './types'
import {
  boardMoves,
  discussProgress,
  dotTotals,
  extendedText,
  extendOutcome,
  myDotsUsed,
  stageRingSize,
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

describe('Discuss board', () => {
  const at = (id: string, status: Topic['status'], extra: Partial<Topic> = {}): Topic => ({
    ...topic(id),
    status,
    ...extra,
  })

  it('says which topic is on stage, or how many are done between topics', () => {
    const merged = at('m', 'open', { merged_into: 'a' })
    const board = [at('a', 'discussed'), at('b', 'discussing'), at('c', 'open'), merged]
    expect(discussProgress(board)).toBe('Topic 2 of 3')
    expect(discussProgress([at('a', 'discussed'), at('c', 'open'), at('d', 'skipped')])).toBe(
      '1 of 3 discussed',
    )
  })

  it('words extensions', () => {
    expect([0, 1, 2, 3].map(extendedText)).toEqual([
      '',
      'extended once',
      'extended twice',
      'extended 3 times',
    ])
  })

  it('shrinks the ring, never the type, for a long topic or the extend vote', () => {
    expect(stageRingSize('x'.repeat(60), false)).toBe(220)
    expect(stageRingSize('x'.repeat(61), false)).toBe(200)
    expect(stageRingSize('Short', true)).toBe(200)
  })

  describe('announcing moves', () => {
    const round = (topicId: string, result: ExtendRound['result'], counted = true) =>
      ({
        id: `r-${topicId}`,
        board_id: 'b',
        topic_id: topicId,
        opened_at: '2026-10-25T10:00:00Z',
        closes_at: '2026-10-25T10:00:15Z',
        closed_at: '2026-10-25T10:00:15Z',
        votes_cast: 2,
        keep_count: counted ? 0 : null,
        neutral_count: counted ? 0 : null,
        move_on_count: counted ? 2 : null,
        result,
      }) satisfies ExtendRound
    const before = [at('a', 'discussing'), at('b', 'open')]

    it('says nothing when nothing moved', () => {
      expect(
        boardMoves(before, [at('a', 'discussing', { text: 'Renamed' }), at('b', 'open')], []),
      ).toBe('')
    })

    it('says a topic finished and the next started', () => {
      const after = [at('a', 'discussed', { time_spent_ms: 312_000 }), at('b', 'discussing')]
      expect(boardMoves(before, after, [])).toBe(
        '"a" moved to Discussed after 5:12. Now discussing "b".',
      )
    })

    it('says a topic was skipped or deferred', () => {
      expect(boardMoves(before, [at('a', 'skipped'), at('b', 'open')], [])).toBe('"a" was skipped.')
      expect(boardMoves(before, [at('a', 'open'), at('b', 'open')], [])).toBe(
        '"a" moved back to the queue for later.',
      )
    })

    it('leaves a Move on vote to its result panel, but not a force-closed round', () => {
      const after = [at('a', 'discussed'), at('b', 'open')]
      expect(boardMoves(before, after, [round('a', 'move_on')])).toBe('')
      expect(boardMoves(before, after, [round('a', 'move_on', false)])).toBe(
        '"a" moved to Discussed after 0:00.',
      )
    })

    it('says when Extend anyway brings a topic back on stage', () => {
      const was = [at('a', 'discussed'), at('b', 'open')]
      expect(boardMoves(was, [at('a', 'discussing'), at('b', 'open')], [])).toBe(
        'Now discussing "a".',
      )
    })
  })
})
