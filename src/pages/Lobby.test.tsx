import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BoardState, Participant, Settings } from '../lib/types'
import { makeCtx as makeBoardCtx } from '../test/boardContext'
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
    timer_started_at: null,
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
      reload: async () => {},
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
    // The name sits in a <bdi>, so a right-to-left name cannot reorder the sentence.
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === 'P' && el.textContent === 'Waiting for Fran to start the session',
      ),
    ).toBeInTheDocument()
  })

  it('renders untrusted names as text, never markup', () => {
    const { container } = render(<Lobby ctx={makeCtx('u2')} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    )
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('Lobby pitch and wrap-up timers', () => {
  it('steps the pitch timer in 15 s steps down to Off', async () => {
    const ctx = makeBoardCtx({ settings: { pitch_s: 15 } })
    render(<Lobby ctx={ctx} />)
    expect(screen.getByRole('group', { name: 'Pitch' })).toHaveTextContent('15 s')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Pitch' }))
    await waitFor(() =>
      expect(ctx.act).toHaveBeenLastCalledWith('update_settings', {
        p_board: 'b1',
        p_settings: { pitch_s: 0 },
      }),
    )
    expect(screen.getByRole('group', { name: 'Pitch' })).toHaveTextContent('Off')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Pitch' }))
    await waitFor(() =>
      expect(ctx.act).toHaveBeenLastCalledWith('update_settings', {
        p_board: 'b1',
        p_settings: { pitch_s: 15 },
      }),
    )
  })

  it('adds up quick presses before the server echoes them', async () => {
    const ctx = makeBoardCtx()
    render(<Lobby ctx={ctx} />)
    const decrease = screen.getByRole('button', { name: 'Decrease Brainstorm' })
    for (let i = 0; i < 6; i++) fireEvent.click(decrease)
    // Shown at once, and sent in press order, each from the last value sent.
    expect(screen.getByRole('group', { name: 'Brainstorm' })).toHaveTextContent('2:00')
    expect(decrease).toBeDisabled()
    await waitFor(() => expect(ctx.act).toHaveBeenCalledTimes(6))
    expect(vi.mocked(ctx.act).mock.calls.map(([, args]) => args?.p_settings)).toEqual(
      [270, 240, 210, 180, 150, 120].map((brainstorm_s) => ({ brainstorm_s })),
    )
  })

  it('shows the server value again when a change fails', async () => {
    const ctx = makeBoardCtx()
    vi.mocked(ctx.act).mockResolvedValue(false)
    render(<Lobby ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase Voting' }))
    expect(screen.getByRole('group', { name: 'Voting' })).toHaveTextContent('2:00')
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Voting' })).toHaveTextContent('1:30'),
    )
  })

  it('shows Off and stops at the ends of each range', () => {
    render(<Lobby ctx={makeBoardCtx({ settings: { pitch_s: 0, wrapup_s: 600 } })} />)
    expect(screen.getByRole('group', { name: 'Pitch' })).toHaveTextContent('Off')
    expect(screen.getByRole('button', { name: 'Decrease Pitch' })).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Wrap-up' })).toHaveTextContent('10:00')
    expect(screen.getByRole('button', { name: 'Increase Wrap-up' })).toBeDisabled()
  })

  it('steps the wrap-up timer in whole minutes down to Off', async () => {
    const ctx = makeBoardCtx({ settings: { wrapup_s: 60 } })
    render(<Lobby ctx={ctx} />)
    expect(screen.getByRole('group', { name: 'Wrap-up' })).toHaveTextContent('1:00')
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Wrap-up' }))
    await waitFor(() =>
      expect(ctx.act).toHaveBeenLastCalledWith('update_settings', {
        p_board: 'b1',
        p_settings: { wrapup_s: 0 },
      }),
    )
  })

  it('keeps the timers read-only for participants', () => {
    render(<Lobby ctx={makeBoardCtx({ userId: 'u2' })} />)
    expect(screen.getByRole('button', { name: 'Increase Pitch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decrease Wrap-up' })).toBeDisabled()
  })
})
