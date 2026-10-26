export type Phase = 'lobby' | 'brainstorm' | 'clarify' | 'vote' | 'discuss' | 'wrapup' | 'ended'

export const PHASES: Phase[] = [
  'lobby',
  'brainstorm',
  'clarify',
  'vote',
  'discuss',
  'wrapup',
  'ended',
]

export interface Settings {
  brainstorm_s: number
  pitch_s: number
  vote_s: number
  discuss_s: number
  extend_s: number
  wrapup_s: number
  dots: number
  own_vote: boolean
  hide_topics: boolean
  tie_break: 'drag' | 'mini_vote' | 'random'
  auto_start_next: boolean
}

export interface BoardState {
  board_id: string
  name: string
  owner_user_id: string
  facilitator_user_id: string
  settings: Settings
  requires_passcode: boolean
  phase: Phase
  planned_minutes: number
  phase_ends_at: string | null
  paused_remaining_ms: number | null
  /** When the clock on the current topic last started; null while it is stopped. */
  timer_started_at: string | null
  current_topic_id: string | null
  pitch_topic_id: string | null
  vote_round: number
  base_round: number
  tie_topic_ids: string[]
  votes_revealed_at: string | null
  topic_count: number
  locked: boolean
  topics_locked: boolean
  started_at: string | null
  ended_at: string | null
}

export interface Participant {
  id: string
  board_id: string
  user_id: string
  display_name: string
  joined_at: string
  last_seen_at: string
  finished_voting: boolean
}

export interface Topic {
  id: string
  board_id: string
  author_user_id: string
  author_name: string
  text: string
  status: 'open' | 'discussing' | 'discussed' | 'skipped'
  merged_into: string | null
  sort_order: number
  time_spent_ms: number
  extensions: number
  discussed_seq: number | null
  created_at: string
}

export interface Vote {
  id: string
  board_id: string
  topic_id: string
  user_id: string
  round: number
  dots: number
}

export interface ExtendRound {
  id: string
  board_id: string
  topic_id: string
  opened_at: string
  closes_at: string
  closed_at: string | null
  votes_cast: number
  keep_count: number | null
  neutral_count: number | null
  move_on_count: number | null
  result: 'extend' | 'move_on' | null
}

export interface ExtendVote {
  id: string
  round_id: string
  user_id: string
  choice: 'keep' | 'neutral' | 'move_on'
}

export interface Action {
  id: string
  board_id: string
  topic_id: string | null
  text: string
  owner_name: string | null
  created_by: string
  done: boolean
  created_at: string
}

export interface Takeaway {
  id: string
  board_id: string
  user_id: string
  author_name: string
  text: string | null
  passed: boolean
}
