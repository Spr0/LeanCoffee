import type { BoardState, Participant, Settings, Topic } from '../../lib/types'
import type { BoardContext } from '../BoardView'

// Test fixtures for the phase screens: a Discuss board with Fran (facilitator, u1) and Pat (u2).

const settings: Settings = {
  brainstorm_s: 300,
  pitch_s: 30,
  vote_s: 90,
  discuss_s: 300,
  extend_s: 180,
  wrapup_s: 300,
  dots: 3,
  own_vote: false,
  hide_topics: true,
  tie_break: 'drag',
  auto_start_next: false,
}

export function makeTopic(id: string, text: string, status: Topic['status'], order = 1): Topic {
  return {
    id,
    board_id: 'b1',
    author_user_id: 'u2',
    author_name: 'Pat',
    text,
    status,
    merged_into: null,
    sort_order: order,
    time_spent_ms: 0,
    extensions: 0,
    discussed_seq: status === 'discussed' ? order : null,
    created_at: '2026-10-25T10:00:00Z',
  }
}

export function makeCtx(
  userId: string,
  topics: Topic[],
  act: BoardContext['act'],
  over: Partial<BoardState> = {},
): BoardContext {
  const now = new Date().toISOString()
  const state: BoardState = {
    board_id: 'b1',
    name: 'Team sync',
    owner_user_id: 'u1',
    facilitator_user_id: 'u1',
    settings,
    requires_passcode: false,
    phase: 'discuss',
    planned_minutes: 75,
    phase_ends_at: null,
    paused_remaining_ms: null,
    timer_started_at: null,
    current_topic_id: topics.find((t) => t.status === 'discussing')?.id ?? null,
    pitch_topic_id: null,
    vote_round: 0,
    base_round: 0,
    tie_topic_ids: [],
    votes_revealed_at: now,
    topic_count: topics.length,
    locked: false,
    topics_locked: false,
    started_at: null,
    ended_at: null,
    ...over,
  }
  const person = (id: string, user: string, name: string): Participant => ({
    id,
    board_id: 'b1',
    user_id: user,
    display_name: name,
    joined_at: now,
    last_seen_at: now,
    finished_voting: false,
  })
  return {
    board: {
      data: {
        state,
        participants: [person('p1', 'u1', 'Fran'), person('p2', 'u2', 'Pat')],
        topics,
        votes: [],
        extendRounds: [],
        extendVotes: [],
        actions: [],
        takeaways: [],
      },
      loaded: true,
      gone: false,
      connection: 'live',
      offsetMs: 0,
      reload: async () => {},
    },
    state,
    userId,
    code: 'KQ74-M2X9',
    isFacilitator: userId === state.facilitator_user_id,
    act,
  }
}
