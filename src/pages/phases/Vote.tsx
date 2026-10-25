import { useRef, useState, type ReactNode } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { Button } from '../../components/ui'
import { callWhenDue } from '../../lib/retry'
import { cards, dotTotals, myDots, myDotsUsed } from '../../lib/session'
import { formatClock, isPresent } from '../../lib/time'
import type { Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import { Check, Eyebrow, Layout, PageTitle, TimerButtons, type PhaseProps } from './common'
import Downloads from './Downloads'

function omit(record: Record<string, number>, key: string): Record<string, number> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

function Dots({ filled, total, label }: { filled: number; total: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-4 rounded-full border-2 border-teal ${i < filled ? 'bg-teal' : ''}`}
        />
      ))}
    </span>
  )
}

export default function Vote({ ctx, remaining }: PhaseProps) {
  const { board, state, userId, isFacilitator, act } = ctx
  const { votes, participants } = board.data
  const revealed = state.votes_revealed_at !== null
  const tieRound = state.vote_round > state.base_round
  const budget = tieRound ? 1 : state.settings.dots
  const used = myDotsUsed(votes, userId, state.vote_round)
  const me = participants.find((p) => p.user_id === userId)
  const now = useNow(5000)
  // Matches the server: only people seen in the last 45 s count toward "everyone finished".
  const present = participants.filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
  const finishedCount = present.filter((p) => p.finished_voting).length
  const revote = state.base_round > 0 && !tieRound
  const open = cards(board.data.topics).filter((t) => t.status === 'open')
  const ballot = tieRound ? open.filter((t) => state.tie_topic_ids.includes(t.id)) : open

  // When the clock runs out, any browser may ask the server to reveal; it checks the deadline.
  useAtZero(remaining, state.phase_ends_at, () => {
    if (!revealed) callWhenDue('reveal_votes', { p_board: state.board_id })
  })

  // Optimistic dots per topic: each click builds on the last value sent, not on whatever the
  // server has echoed back yet, so quick clicks add up. Entries clear once the server agrees.
  const [pending, setPending] = useState<Record<string, number>>({})
  const queue = useRef<Promise<void>>(Promise.resolve())
  const serverDots = (id: string) => myDots(votes, userId, state.vote_round, id)
  const dotsOn = (id: string) => pending[id] ?? serverDots(id)
  const usedNow =
    ballot.reduce((n, t) => n + dotsOn(t.id), 0) +
    (used - ballot.reduce((n, t) => n + serverDots(t.id), 0))
  const cast = async (t: Topic, delta: number) => {
    const target = dotsOn(t.id) + delta
    setPending((p) => ({ ...p, [t.id]: target }))
    // Send in click order: parallel requests can arrive out of order and undo a later click.
    queue.current = queue.current.then(async () => {
      if (!(await act('cast_dots', { p_topic: t.id, p_dots: target })))
        setPending((p) => omit(p, t.id))
    })
    await queue.current
  }
  for (const [id, n] of Object.entries(pending)) {
    if (serverDots(id) === n) {
      setPending((p) => omit(p, id))
      break
    }
  }

  const side = (
    <>
      <ClockPanel
        title={tieRound ? 'Tie-break clock' : 'Voting clock'}
        remaining={revealed ? null : remaining}
        totalMs={(tieRound ? 30 : revote ? 60 : state.settings.vote_s) * 1000}
        paused={state.paused_remaining_ms !== null}
      />
      <div>
        <Eyebrow right={`${finishedCount} of ${present.length}`}>Who has finished</Eyebrow>
        <ul className="mt-2">
          {present.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5 text-[16px]">
              <span className={p.finished_voting ? '' : 'text-muted'}>
                {p.display_name}
                {p.user_id === userId && ' (you)'}
              </span>
              {p.finished_voting ? (
                <span className="flex items-center gap-1 text-[14px]">
                  <Check /> <span className="sr-only">finished</span>
                </span>
              ) : (
                <span className="text-[14px] text-muted">Still voting</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {isFacilitator && !revealed && (
        <div className="flex flex-col gap-2">
          <Button className="h-12" onClick={() => act('reveal_votes', { p_board: state.board_id })}>
            Reveal results now
          </Button>
          <TimerButtons ctx={ctx} addSeconds={30} />
        </div>
      )}
      <div>
        <Eyebrow>Session rules</Eyebrow>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5 text-[15px]">
          <dt>Dots per person</dt>
          <dd className="font-bold">{state.settings.dots}</dd>
          <dt>Discussion timebox</dt>
          <dd className="font-bold">{formatClock(state.settings.discuss_s * 1000)}</dd>
          <dt>Extend by</dt>
          <dd className="font-bold">{formatClock(state.settings.extend_s * 1000)}</dd>
          <dt>Voting on own topic</dt>
          <dd className="font-bold">{state.settings.own_vote ? 'On' : 'Off'}</dd>
        </dl>
      </div>
      {revealed && <Downloads data={board.data} />}
    </>
  )

  if (revealed) return <Results ctx={ctx} side={side} />

  return (
    <Layout
      ctx={ctx}
      side={side}
      main={
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <PageTitle
              title={
                tieRound
                  ? 'Tie-break: one dot for the topic you most want first'
                  : `Spend your ${budget} dots on what you most want to discuss`
              }
              intro="Stack dots on one topic or spread them out. You can change your mind until the clock ends."
            />
            <div className="flex flex-col items-end gap-2">
              <span className="flex items-center gap-3 text-[15px] font-bold">
                Your dots{' '}
                <Dots filled={usedNow} total={budget} label={`${usedNow} of ${budget} dots used`} />
                <span className="font-medium text-muted">{budget - usedNow} left</span>
              </span>
              <span className="rounded-full bg-teal-soft px-3 py-1 text-[14px] font-bold text-teal">
                Counts hidden until reveal
              </span>
            </div>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ballot.map((t) => {
              const mine = dotsOn(t.id)
              const own = t.author_user_id === userId && !state.settings.own_vote
              return (
                <li
                  key={t.id}
                  className={`flex flex-col rounded-xl border-2 p-4 ${own ? 'border-dashed border-line bg-surface' : 'border-line-soft bg-panel'}`}
                >
                  <p className="text-[17px] font-bold">{t.text}</p>
                  <p className="mt-1 text-[14px] text-muted">{t.author_name}</p>
                  {own ? (
                    <p className="mt-3 text-[14px] text-muted">
                      <span className="mr-2 rounded bg-teal-soft px-2 py-0.5 text-[13px] font-bold text-teal">
                        YOUR TOPIC
                      </span>
                      Voting on your own topic is off.
                    </p>
                  ) : (
                    <div className="mt-auto flex items-center justify-between pt-4">
                      <button
                        type="button"
                        aria-label={`Remove a dot from "${t.text}"`}
                        disabled={mine === 0}
                        onClick={() => cast(t, -1)}
                        className="size-11 rounded-lg border-2 border-line text-xl font-bold disabled:opacity-40"
                      >
                        −
                      </button>
                      {mine > 0 ? (
                        <Dots filled={mine} total={mine} label={`${mine} of your dots`} />
                      ) : (
                        <span className="text-[14px] text-muted">No dots yet</span>
                      )}
                      <button
                        type="button"
                        aria-label={`Add a dot to "${t.text}"`}
                        disabled={usedNow >= budget}
                        onClick={() => cast(t, 1)}
                        className="size-11 rounded-lg bg-teal text-xl font-bold text-on-teal disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-6 flex items-center gap-4">
            <Button
              variant={me?.finished_voting ? 'secondary' : 'primary'}
              className="h-12"
              aria-pressed={me?.finished_voting ?? false}
              onClick={() =>
                act('finish_voting', { p_board: state.board_id, p_done: !me?.finished_voting })
              }
            >
              {me?.finished_voting ? "I'm done (undo)" : "I'm done"}
            </Button>
            <p className="text-[14px] text-muted">
              Results appear when everyone is done, the clock ends, or the facilitator reveals.
            </p>
          </div>
        </>
      }
    />
  )
}

function Results({ ctx, side }: { ctx: PhaseProps['ctx']; side: ReactNode }) {
  const { board, state, isFacilitator, act } = ctx
  const open = cards(board.data.topics).filter((t) => t.status === 'open')
  const main = dotTotals(board.data.votes, state.base_round)
  // Tie-round dots break ties: topics stay tied only if both totals match.
  const tie = new Map<string, number>()
  for (const v of board.data.votes)
    if (v.round > state.base_round) tie.set(v.topic_id, (tie.get(v.topic_id) ?? 0) + v.dots)
  const key = (id: string) => `${main.get(id) ?? 0}/${tie.get(id) ?? 0}`
  const byKey = new Map<string, Topic[]>()
  for (const t of open) byKey.set(key(t.id), [...(byKey.get(key(t.id)) ?? []), t])
  const groups = [...byKey.values()].filter((g) => g.length > 1)
  const tied = new Set(groups.flat().map((t) => t.id))
  const move = (index: number, delta: number) => {
    const ids = open.map((t) => t.id)
    const [id] = ids.splice(index, 1)
    if (!id) return
    ids.splice(index + delta, 0, id)
    void act('reorder_topics', { p_board: state.board_id, p_ids: ids })
  }

  return (
    <Layout
      ctx={ctx}
      side={side}
      main={
        <>
          <PageTitle
            title="Here is the agenda"
            intro="Topics are ordered by dots, then by any tie-break."
          />
          {isFacilitator && groups.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
              <p className="flex-1 text-[15px]">
                <b>{groups.length === 1 ? 'One tie.' : `${groups.length} ties.`}</b>{' '}
                {state.settings.tie_break === 'drag' &&
                  'Use the arrows to put tied topics in the order you want.'}
                {state.settings.tie_break === 'random' &&
                  'Break them with a random draw, or use the arrows.'}
                {state.settings.tie_break === 'mini_vote' &&
                  'Run a 30-second one-dot vote among tied topics.'}
              </p>
              {state.settings.tie_break === 'random' && (
                <Button
                  variant="secondary"
                  onClick={() => act('break_ties_random', { p_board: state.board_id })}
                >
                  Break ties at random
                </Button>
              )}
              {state.settings.tie_break === 'mini_vote' &&
                groups.map((g) => (
                  <Button
                    key={g[0]?.id}
                    variant="secondary"
                    onClick={() =>
                      act('start_tie_vote', {
                        p_board: state.board_id,
                        p_topics: g.map((t) => t.id),
                      })
                    }
                  >
                    Quick vote on {g.length} tied at {main.get(g[0]?.id ?? '') ?? 0}
                  </Button>
                ))}
            </div>
          )}
          <ol className="mt-6 flex flex-col gap-2">
            {open.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center gap-4 rounded-xl border border-line-soft bg-panel p-4"
              >
                <span className="w-6 text-[17px] font-extrabold text-muted">{i + 1}</span>
                <span className="flex-1">
                  <span className="block text-[17px] font-bold">{t.text}</span>
                  <span className="text-[14px] text-muted">{t.author_name}</span>
                </span>
                {tied.has(t.id) && (
                  <span className="rounded bg-teal-soft px-2 py-0.5 text-[13px] font-bold text-teal">
                    TIED
                  </span>
                )}
                <span
                  className="text-[17px] font-extrabold"
                  aria-label={`${main.get(t.id) ?? 0} dots${tie.has(t.id) ? `, plus ${tie.get(t.id)} in the tie-break` : ''}`}
                >
                  {main.get(t.id) ?? 0}
                  {tie.has(t.id) && (
                    <span className="ml-1 text-[14px] text-muted">+{tie.get(t.id)} tie</span>
                  )}
                </span>
                {isFacilitator && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="size-11 rounded-lg border-2 border-line font-bold disabled:opacity-30"
                      disabled={i === 0}
                      aria-label={`Move "${t.text}" up`}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="size-11 rounded-lg border-2 border-line font-bold disabled:opacity-30"
                      disabled={i === open.length - 1}
                      aria-label={`Move "${t.text}" down`}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {isFacilitator && (
            <Button
              className="mt-6 h-14 px-8 text-[17px]"
              onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'discuss' })}
            >
              Start discussing
            </Button>
          )}
        </>
      }
    />
  )
}
