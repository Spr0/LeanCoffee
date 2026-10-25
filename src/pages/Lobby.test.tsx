import { render, screen } from '@testing-library/react'
import type { BoardState, Participant, Settings } from '../lib/types'
import type { BoardContext } from './BoardView'
import Lobby from './Lobby'

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

function makeCtx(userId: string): BoardContext {
  const now = new Date().toISOString()
  const state = {
    board_id: 'b1',
    name: '<img src=x onerror=alert(1)>',
    owner_user_id: 'u1',
    facilitator_user_id: 'u1',
    settings,
    requires_passcode: false,
    phase: 'lobby',
    planned_minutes: 75,
    phase_ends_at: null,
    paused_remaining_ms: null,
    current_topic_id: null,
    pitch_topic_id: null,
    vote_round: 0,
    base_round: 0,
    tie_topic_ids: [],
    votes_revealed_at: null,
    topic_count: 0,
    locked: false,
    topics_locked: false,
    started_at: null,
    ended_at: null,
  } satisfies BoardState
  const people: Participant[] = [
    {
      id: 'p1',
      board_id: 'b1',
      user_id: 'u1',
      display_name: 'Fran',
      joined_at: now,
      last_seen_at: now,
      finished_voting: false,
    },
    {
      id: 'p2',
      board_id: 'b1',
      user_id: 'u2',
      display_name: 'Pat',
      joined_at: now,
      last_seen_at: now,
      finished_voting: false,
    },
  ]
  return {
    board: {
      data: {
        state,
        participants: people,
        topics: [],
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
      refresh: async () => {},
    },
    state,
    userId,
    code: 'KQ74-M2X9',
    isFacilitator: userId === 'u1',
    act: vi.fn(async () => true),
  }
}

describe('Lobby', () => {
  it('gives the facilitator the start button and editable rules', () => {
    render(<Lobby ctx={makeCtx('u1')} />)
    expect(screen.getByRole('button', { name: 'Start brainstorm for 2 people' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Increase Voting' })).toBeEnabled()
  })

  it('shows participants the rules read-only and no start button', () => {
    render(<Lobby ctx={makeCtx('u2')} />)
    expect(screen.queryByRole('button', { name: /Start brainstorm/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Increase Voting' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Hide topics until reveal' })).toBeDisabled()
    expect(screen.getByText('Waiting for Fran to start the session')).toBeInTheDocument()
  })

  it('renders untrusted names as text, never markup', () => {
    const { container } = render(<Lobby ctx={makeCtx('u2')} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
