import type { BoardState, ExtendRound, Topic, Vote } from './types'
import {
  boardMoves,
  boardTotals,
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
    expect(stageRingSize('x'.repeat(45), false, 300_000)).toBe(220)
    expect(stageRingSize('x'.repeat(46), false, 300_000)).toBe(200)
    expect(stageRingSize('x'.repeat(160), false, 300_000)).toBe(200)
    expect(stageRingSize('Short', true, 300_000)).toBe(200)
  })

  it('gives a clock of 10:00 or more the 240 px ring, whatever else is on stage', () => {
    expect(stageRingSize('Short', false, 600_000)).toBe(240)
    expect(stageRingSize('x'.repeat(160), true, 599_500)).toBe(240)
    expect(stageRingSize('Short', false, 599_000)).toBe(220)
  })

  it('keeps the dots that ranked discussed and skipped topics after a re-vote', () => {
    const votes = [
      vote('done', 'u1', 4),
      vote('done', 'u2', 2),
      vote('skip', 'u1', 1),
      vote('open', 'u1', 3),
      vote('open', 'u2', 1, 1),
    ]
    const topics = [at('done', 'discussed'), at('skip', 'skipped'), at('open', 'open')]
    expect(Object.fromEntries(boardTotals(votes, topics, 0))).toEqual({ done: 6, skip: 1, open: 3 })
    // Round 1 re-voted the open topics only: open ones count it, the others keep round 0.
    expect(Object.fromEntries(boardTotals(votes, topics, 1))).toEqual({ done: 6, skip: 1, open: 1 })
  })

  describe('announcing moves', () => {
    const round = (
      topicId: string,
      result: ExtendRound['result'],
      counts: [number, number, number] | null = [0, 0, 2],
      closed = true,
    ) =>
      ({
        id: `r-${topicId}`,
        board_id: 'b',
        topic_id: topicId,
        opened_at: '2026-10-25T10:00:00Z',
        closes_at: '2026-10-25T10:00:15Z',
        closed_at: closed ? '2026-10-25T10:00:15Z' : null,
        votes_cast: 2,
        keep_count: counts?.[0] ?? null,
        neutral_count: counts?.[1] ?? null,
        move_on_count: counts?.[2] ?? null,
        result: closed ? result : null,
      }) satisfies ExtendRound
    const moment = (topics: Topic[], rounds: ExtendRound[] = []) => ({ topics, rounds })
    const before = moment([at('a', 'discussing'), at('b', 'open')])
    const moves = (from: ReturnType<typeof moment>, to: ReturnType<typeof moment>) =>
      boardMoves(from, to, 180_000)

    it('says nothing when nothing moved', () => {
      expect(
        moves(before, moment([at('a', 'discussing', { text: 'Renamed' }), at('b', 'open')])),
      ).toBe('')
    })

    it('says a topic finished and the next started', () => {
      const after = [at('a', 'discussed', { time_spent_ms: 312_000 }), at('b', 'discussing')]
      expect(moves(before, moment(after))).toBe(
        '"a" moved to Discussed after 5:12. Now discussing "b".',
      )
    })

    it('says a topic was skipped or deferred', () => {
      expect(moves(before, moment([at('a', 'skipped'), at('b', 'open')]))).toBe('"a" was skipped.')
      expect(moves(before, moment([at('a', 'open'), at('b', 'open')]))).toBe(
        '"a" moved back to the queue for later.',
      )
    })

    it('says a Move on vote once, whichever table reloads first', () => {
      const open = round('a', null, null, false)
      const voted = round('a', 'move_on', [1, 1, 4])
      const was = moment(before.topics, [open])
      const off = [at('a', 'discussed'), at('b', 'open')]
      const said =
        'The group chose to move on: "a" moved to Discussed (1 keep going, 1 neutral, 4 move on).'
      // Both together.
      expect(moves(was, moment(off, [voted]))).toBe(said)
      // The vote first, then the topic.
      expect(moves(was, moment(before.topics, [voted]))).toBe(said)
      expect(moves(moment(before.topics, [voted]), moment(off, [voted]))).toBe('')
      // The topic first, while its vote still looks open, then the vote.
      expect(moves(was, moment(off, [open]))).toBe('')
      expect(moves(moment(off, [open]), moment(off, [voted]))).toBe(said)
    })

    it('says a topic taken off stage during a vote, whichever table reloads first', () => {
      const open = round('a', null, null, false)
      const forced = round('a', 'move_on', null)
      const was = moment(before.topics, [open])
      const off = [at('a', 'discussed', { time_spent_ms: 200_000 }), at('b', 'open')]
      const said = '"a" moved to Discussed after 3:20.'
      expect(moves(was, moment(off, [forced]))).toBe(said)
      expect(moves(was, moment(before.topics, [forced]))).toBe('')
      expect(moves(moment(before.topics, [forced]), moment(off, [forced]))).toBe(said)
      expect(moves(was, moment(off, [open]))).toBe('')
      expect(moves(moment(off, [open]), moment(off, [forced]))).toBe(said)
    })

    it('says who extended a topic: the group, or the facilitator against the vote', () => {
      const was = moment(before.topics, [round('a', null, null, false)])
      expect(moves(was, moment(before.topics, [round('a', 'extend', [3, 0, 1])]))).toBe(
        'The group chose to keep going on "a": 3:00 added.',
      )
      expect(moves(was, moment(before.topics, [round('a', 'extend', [0, 1, 3])]))).toBe(
        'The facilitator extended "a": 3:00 added.',
      )
    })

    it('says when Extend anyway brings a topic back on stage', () => {
      const was = moment(
        [at('a', 'discussed'), at('b', 'open')],
        [round('a', 'move_on', [0, 1, 3])],
      )
      const after = moment(before.topics, [round('a', 'extend', [0, 1, 3])])
      expect(moves(was, after)).toBe(
        'The facilitator extended "a": 3:00 added. Now discussing "a".',
      )
    })
  })
})
