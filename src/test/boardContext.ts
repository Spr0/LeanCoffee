import { vi } from 'vitest'
import type { BoardContext } from '../pages/BoardView'
import type { BoardState, Participant, Settings, Topic } from '../lib/types'

export const SETTINGS: Settings = {
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

export function person(userId: string, name: string, lastSeenAt = new Date().toISOString()) {
  return {
    id: `p-${userId}`,
    board_id: 'b1',
    user_id: userId,
    display_name: name,
    joined_at: lastSeenAt,
    last_seen_at: lastSeenAt,
    finished_voting: false,
  } satisfies Participant
}

export function topic(id: string, text: string, author = 'u2', extra: Partial<Topic> = {}): Topic {
  return {
    id,
    board_id: 'b1',
    author_user_id: author,
    author_name: author === 'u1' ? 'Fran' : 'Pat',
    text,
    status: 'open',
    merged_into: null,
    sort_order: Number(id.replace(/\D/g, '')) || 0,
    time_spent_ms: 0,
    extensions: 0,
    discussed_seq: null,
    created_at: new Date().toISOString(),
    ...extra,
  }
}

/** A board context for component tests: Fran (u1) facilitates, Pat (u2) participates. */
export function makeCtx({
  userId = 'u1',
  state = {},
  settings = {},
  topics = [],
  participants = [person('u1', 'Fran'), person('u2', 'Pat')],
}: {
  userId?: string
  state?: Partial<BoardState>
  settings?: Partial<Settings>
  topics?: Topic[]
  participants?: Participant[]
} = {}): BoardContext {
  const full: BoardState = {
    board_id: 'b1',
    name: 'Team sync',
    owner_user_id: 'u1',
    facilitator_user_id: 'u1',
    settings: { ...SETTINGS, ...settings },
    requires_passcode: false,
    phase: 'lobby',
    planned_minutes: 75,
    phase_ends_at: null,
    paused_remaining_ms: null,
    timer_started_at: null,
    current_topic_id: null,
    pitch_topic_id: null,
    vote_round: 0,
    base_round: 0,
    tie_topic_ids: [],
    votes_revealed_at: null,
    topic_count: topics.length,
    locked: false,
    topics_locked: false,
    started_at: null,
    ended_at: null,
    ...state,
  }
  return {
    board: {
      data: {
        state: full,
        participants,
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
    state: full,
    userId,
    code: 'KQ74-M2X9',
    isFacilitator: full.facilitator_user_id === userId,
    act: vi.fn(async () => true),
  }
}
