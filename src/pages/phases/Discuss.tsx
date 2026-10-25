import { useId, useRef, useState, type FormEvent } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import {
  cards,
  dotTotals,
  extendOutcome,
  formatDuration,
  lastRound,
  openRound,
  sessionMinutesLeft,
  topicsThatFit,
} from '../../lib/session'
import { callWhenDue } from '../../lib/retry'
import { formatClock, isPresent } from '../../lib/time'
import type { ExtendVote } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import BoardTab from './BoardTab'
import { Check, Eyebrow, Layout, TimerButtons, type PhaseProps } from './common'
import { OwnerField, ownerName } from './OwnerField'
import { BringBack, TOPIC_MAX } from './TopicTools'

const CHOICES: { value: ExtendVote['choice']; label: string }[] = [
  { value: 'keep', label: 'Keep going' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'move_on', label: 'Move on' },
]

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function Discuss({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator, act } = ctx
  const { topics, extendRounds, actions, participants } = board.data
  const [view, setView] = useState<'stage' | 'board'>('stage')
  const [note, setNote] = useState('')
  const queueList = useRef<HTMLOListElement>(null)
  const now = useNow(1000)
  const nowServer = now + board.offsetMs
  const current = topics.find((t) => t.id === state.current_topic_id)
  const queue = cards(topics).filter((t) => t.status === 'open')
  const skipped = cards(topics).filter((t) => t.status === 'skipped')
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const totals = dotTotals(board.data.votes, state.base_round)
  const round = openRound(extendRounds, state.current_topic_id)
  const last = lastRound(extendRounds, state.current_topic_id)
  const minutesLeft = sessionMinutesLeft(state, nowServer)
  // The topic on stage still needs its remaining time before the next one can start.
  const fit =
    minutesLeft === null
      ? null
      : topicsThatFit(
          minutesLeft - (current ? (remaining ?? 0) / 60_000 : 0),
          state.settings.discuss_s,
          state.settings.wrapup_s,
        )
  // A topic brought back after an extension restarts at the full discussion time.
  const totalMs = Math.max(
    remaining ?? 0,
    (current && current.extensions > 0 ? state.settings.extend_s : state.settings.discuss_s) * 1000,
  )
  const roundLeft = round ? Math.max(0, Date.parse(round.closes_at) - nowServer) : null
  // Keep a closed vote's result on screen for 10 s, or while the clock sits at zero.
  const recentlyClosed = last?.closed_at ? nowServer - Date.parse(last.closed_at) < 10_000 : false
  const shownRound = round ?? (last && (remaining === 0 || recentlyClosed) ? last : undefined)
  const lastDiscussed = discussed.at(-1)
  // A Move on vote takes the topic off stage on the server; its result stays up until the next
  // topic starts, so the facilitator can still override it. Rounds force-closed have no counts.
  const lastDiscussedRound = lastDiscussed && lastRound(extendRounds, lastDiscussed.id)
  const movedOn =
    !current && lastDiscussedRound?.result === 'move_on' && lastDiscussedRound.keep_count !== null
      ? lastDiscussedRound
      : undefined

  // At zero: chime, and any browser may open the extend vote (the server checks the deadline).
  useAtZero(remaining, current ? state.phase_ends_at : null, () => {
    chime()
    callWhenDue('open_extend_round', { p_board: state.board_id })
  })
  // When the 15-second window closes, any browser may ask the server to resolve it.
  useAtZero(roundLeft, round?.id ?? null, () => {
    if (round) callWhenDue('resolve_extend_round', { p_round: round.id })
  })

  const toggle = (
    <div role="group" aria-label="View" className="flex rounded-xl border-2 border-line p-1">
      {(['stage', 'board'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={`min-h-11 rounded-lg px-5 text-[15px] font-bold ${view === v ? 'bg-teal text-on-teal' : ''}`}
        >
          {v === 'stage' ? 'Stage' : 'Board'}
        </button>
      ))}
    </div>
  )

  const main = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle}
        {fit !== null && minutesLeft !== null && (
          <p className="text-[15px] text-muted">
            About{' '}
            <b className="text-ink">
              {fit} more {fit === 1 ? 'topic' : 'topics'}
            </b>{' '}
            fit in the {Math.round(minutesLeft)} minutes left
          </p>
        )}
      </div>
      {minutesLeft !== null && minutesLeft <= 5 && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-urgent p-4"
        >
          <p className="flex-1 text-[16px] font-bold">
            About 5 minutes left in the session. Time to wrap up.
          </p>
          {isFacilitator && (
            <Button
              onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'wrapup' })}
            >
              Start wrap-up
            </Button>
          )}
        </div>
      )}
      {view === 'board' ? (
        <BoardTab ctx={ctx} totals={totals} />
      ) : current ? (
        <>
          <section
            aria-label="Now discussing"
            className="mt-5 rounded-2xl border border-line-soft bg-panel p-6 xl:p-8"
          >
            <div className={shownRound ? '' : 'flex flex-wrap items-center justify-between gap-8'}>
              <div className="min-w-0 grow basis-72">
                <div className="flex gap-2">
                  <span className="rounded-md bg-teal-soft px-2.5 py-1 text-[14px] font-extrabold tracking-[0.08em] text-teal">
                    DISCUSSING NOW
                  </span>
                  <span className="rounded-md bg-surface px-2.5 py-1 text-[14px] font-bold">
                    {plural(totals.get(current.id) ?? 0, 'vote')}
                  </span>
                  {current.extensions > 0 && (
                    <span className="rounded-md bg-surface px-2.5 py-1 text-[14px] font-bold">
                      Extended ×{current.extensions}
                    </span>
                  )}
                </div>
                <h1 className="mt-4 text-[48px] leading-[1.1] font-extrabold tracking-tight break-words">
                  {current.text}
                </h1>
                <p className="mt-3 text-[18px] text-muted">
                  Raised by <b className="text-ink">{current.author_name}</b>, who starts the
                  conversation
                </p>
              </div>
              {!shownRound && (
                <RingTimer
                  remaining={remaining}
                  totalMs={totalMs}
                  paused={state.paused_remaining_ms !== null}
                />
              )}
            </div>
            {/* During the extend vote the ring shrinks and sits beside the vote, so both fit a 720 px share. */}
            {shownRound && (
              <div className="mt-5 flex flex-wrap items-center gap-6">
                <RingTimer
                  remaining={remaining}
                  totalMs={totalMs}
                  paused={state.paused_remaining_ms !== null}
                  size={200}
                />
                <div className="min-w-[320px] flex-1">
                  <ExtendPanel ctx={ctx} roundId={shownRound.id} roundLeft={roundLeft} />
                </div>
              </div>
            )}
          </section>

          {isFacilitator && (
            <div className="mt-4 flex flex-wrap gap-2">
              <TimerButtons ctx={ctx} />
              {!round && (
                <Button
                  variant="secondary"
                  onClick={() => act('open_extend_round', { p_board: state.board_id })}
                >
                  Call vote now
                </Button>
              )}
              <Button
                onClick={() =>
                  act('next_topic', { p_board: state.board_id, p_outcome: 'discussed' })
                }
              >
                Next topic
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  act('next_topic', { p_board: state.board_id, p_outcome: 'deferred' })
                }
              >
                Defer to later
              </Button>
              <Button
                variant="ghost"
                onClick={() => act('next_topic', { p_board: state.board_id, p_outcome: 'skipped' })}
              >
                Skip
              </Button>
            </div>
          )}
          <ActionsFor ctx={ctx} topicId={current.id} />
        </>
      ) : (
        <section className="mt-5 rounded-2xl border border-line-soft bg-panel p-8">
          {movedOn && lastDiscussed && (
            <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border-2 border-teal p-4">
              <p className="flex-1 text-[17px]" role="status">
                <b>The group chose to move on.</b> "{lastDiscussed.text}" is now discussed (
                {movedOn.keep_count} keep going, {movedOn.neutral_count} neutral,{' '}
                {movedOn.move_on_count} move on).
              </p>
              {isFacilitator && (
                <Button
                  variant="secondary"
                  onClick={() => act('extend_topic', { p_board: state.board_id })}
                >
                  Extend {formatClock(state.settings.extend_s * 1000)} anyway
                </Button>
              )}
            </div>
          )}
          {queue[0] ? (
            <>
              <p className="text-[14px] font-bold tracking-[0.1em] text-muted">UP NEXT</p>
              <h1 className="mt-3 text-[44px] leading-tight font-extrabold">{queue[0].text}</h1>
              <p className="mt-2 text-[18px] text-muted">Raised by {queue[0].author_name}</p>
              {isFacilitator ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button
                    className="h-14 px-8 text-[17px]"
                    onClick={() => act('start_discussion', { p_board: state.board_id })}
                  >
                    Start the {formatClock(state.settings.discuss_s * 1000)} clock
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => act('revote', { p_board: state.board_id })}
                  >
                    Re-vote remaining topics
                  </Button>
                </div>
              ) : (
                <p className="mt-6 text-[17px] font-bold" aria-live="polite">
                  Waiting for the facilitator to start the next topic.
                </p>
              )}
            </>
          ) : (
            <>
              <h1 className="text-[36px] font-extrabold">
                {skipped.length > 0
                  ? 'No topics left in the queue'
                  : 'Every topic has been discussed'}
              </h1>
              {isFacilitator && (
                <Button
                  className="mt-6 h-14 px-8"
                  onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'wrapup' })}
                >
                  Start wrap-up
                </Button>
              )}
            </>
          )}
          {lastDiscussed && (
            <ActionsFor ctx={ctx} topicId={lastDiscussed.id} label="Actions from the last topic" />
          )}
        </section>
      )}
    </>
  )

  const elapsed = minutesLeft === null ? 0 : state.planned_minutes - minutesLeft
  const side = (
    <>
      <div>
        <Eyebrow right={`${Math.round(elapsed)} of ${state.planned_minutes} min`}>
          Session clock
        </Eyebrow>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div
            className="h-full bg-teal"
            style={{ width: `${Math.min(100, (elapsed / state.planned_minutes) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] text-muted">A wrap-up reminder appears at 5 minutes left.</p>
      </div>
      <div>
        <Eyebrow right={`${queue.length}`}>Up next</Eyebrow>
        <ol ref={queueList} tabIndex={-1} aria-label="Up next" className="mt-2 flex flex-col gap-2">
          {queue.map((t, i) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-xl border border-line-soft bg-panel p-3"
            >
              <span className="flex-1 text-[15px] font-bold">{t.text}</span>
              <span
                className="rounded bg-teal-soft px-2 text-[14px] font-bold text-teal"
                aria-label={`${totals.get(t.id) ?? 0} votes`}
              >
                {totals.get(t.id) ?? 0}
              </span>
              {isFacilitator && (
                <>
                  <button
                    type="button"
                    className="size-11 rounded-lg border-2 border-line font-bold disabled:opacity-30"
                    disabled={i === 0}
                    aria-label={`Move "${t.text}" up`}
                    onClick={() => {
                      const ids = queue.map((q) => q.id)
                      const [prev, cur] = [ids[i - 1], ids[i]]
                      if (prev && cur) ids.splice(i - 1, 2, cur, prev)
                      void act('reorder_topics', { p_board: state.board_id, p_ids: ids })
                    }}
                  >
                    ↑
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
        {!state.topics_locked && <ParkingLot ctx={ctx} />}
      </div>
      {skipped.length > 0 && (
        <div>
          <Eyebrow right={`${skipped.length}`}>Skipped</Eyebrow>
          <ul className="mt-2 flex flex-col gap-2">
            {skipped.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-xl border-2 border-dashed border-line bg-panel p-3"
              >
                <span className="flex-1 text-[15px] break-words">{t.text}</span>
                {isFacilitator && (
                  <BringBack
                    ctx={ctx}
                    topic={t}
                    onBack={(message) => {
                      // The button disappears, so focus moves to the queue it returned to.
                      setNote(message)
                      queueList.current?.focus()
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p role="status" className="sr-only">
        {note}
      </p>
      {discussed.length > 0 && (
        <div>
          <Eyebrow>Discussed</Eyebrow>
          <ul className="mt-2 flex flex-col gap-2">
            {discussed.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-line-soft bg-panel p-3 text-[14px]"
              >
                <Check />
                <span className="flex-1">{t.text}</span>
                <span className="text-muted">
                  {formatDuration(t.time_spent_ms)} ·{' '}
                  {actions.filter((a) => a.topic_id === t.id).length} actions
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {isFacilitator && !current && queue.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'wrapup' })}
        >
          Start wrap-up
        </Button>
      )}
      <p className="sr-only">{participants.length} people on this board</p>
    </>
  )

  return <Layout ctx={ctx} main={main} side={side} />
}

function ExtendPanel({
  ctx,
  roundId,
  roundLeft,
}: {
  ctx: PhaseProps['ctx']
  roundId: string
  roundLeft: number | null
}) {
  const { board, state, userId, act } = ctx
  const now = useNow(5000)
  const round = board.data.extendRounds.find((r) => r.id === roundId)
  if (!round) return null
  const closed = round.closed_at !== null
  // "Extend anyway" keeps the group's counts but sets the result, so the counts tell who decided.
  const groupExtended = extendOutcome(round.keep_count ?? 0, round.move_on_count ?? 0) === 'extend'
  const mine = board.data.extendVotes.find((v) => v.round_id === roundId && v.user_id === userId)
  const counts = {
    keep: round.keep_count,
    neutral: round.neutral_count,
    move_on: round.move_on_count,
  }
  const present = board.data.participants.filter((p) =>
    isPresent(p.last_seen_at, now, board.offsetMs),
  ).length
  return (
    <section aria-label="Extend vote" className="rounded-2xl border-2 border-teal bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[24px] font-extrabold">Keep talking about this?</h2>
        {/* Only the vote count is announced; the per-second countdown is not. */}
        <p className="text-[16px] font-bold">
          <span aria-live="polite">
            {closed ? 'Voting closed' : `${round.votes_cast} of ${present} voted`}
          </span>
          {!closed && ` · closes in ${formatClock(roundLeft ?? 0)}`}
        </p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={closed}
            aria-pressed={mine?.choice === c.value}
            onClick={() => act('cast_extend_vote', { p_round: roundId, p_choice: c.value })}
            className={`flex min-h-14 items-center justify-between rounded-xl border-2 px-4 text-[17px] font-bold disabled:cursor-default ${mine?.choice === c.value ? 'border-teal bg-teal-soft' : 'border-line'}`}
          >
            <span>
              {c.label}
              {mine?.choice === c.value && (
                <span className="ml-2 text-[14px] text-teal">✓ Your vote</span>
              )}
            </span>
            {/* Tallies stay hidden until the round closes; nothing about them is in the page before then. */}
            <span className="text-[22px] font-extrabold">{closed ? counts[c.value] : '?'}</span>
          </button>
        ))}
      </div>
      {closed && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-[17px] font-bold" role="status">
            {round.result !== 'extend'
              ? 'The group chose to move on.'
              : `${groupExtended ? 'The group chose to keep going' : 'The facilitator extended it'}: ${formatClock(state.settings.extend_s * 1000)} added.`}
          </p>
        </div>
      )}
      {!closed && (
        <p className="mt-3 text-[14px] text-muted">
          Results show when everyone has voted or the 15 seconds are up.
        </p>
      )}
    </section>
  )
}

function ActionsFor({
  ctx,
  topicId,
  label = 'Actions from this topic',
}: {
  ctx: PhaseProps['ctx']
  topicId: string
  label?: string
}) {
  const { board, state, act } = ctx
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const list = board.data.actions.filter((a) => a.topic_id === topicId)
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    if (
      await act('add_action', {
        p_board: state.board_id,
        p_text: text,
        p_owner_name: ownerName(owner),
        p_topic: topicId,
      })
    ) {
      setText('')
      setOwner('')
    }
  }
  return (
    <div className="mt-6">
      <Eyebrow>{label}</Eyebrow>
      <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
        <input
          aria-label="New action"
          value={text}
          maxLength={140}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an action, such as: Ana to share her prompt library"
          className="h-12 min-w-0 grow basis-60 rounded-xl border-2 border-line bg-panel px-3 text-[16px]"
        />
        <OwnerField
          value={owner}
          onChange={setOwner}
          people={board.data.participants}
          className="h-12 rounded-xl"
        />
        <Button type="submit" className="h-12">
          Add action
        </Button>
      </form>
      <ul className="mt-2 flex flex-col gap-2">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl bg-surface p-3">
            <input
              type="checkbox"
              className="size-5 accent-[var(--teal)]"
              checked={a.done}
              aria-label={`Done: ${a.text}`}
              onChange={(e) => act('toggle_action', { p_action: a.id, p_done: e.target.checked })}
            />
            <span className={`flex-1 text-[16px] ${a.done ? 'line-through' : ''}`}>{a.text}</span>
            {a.owner_name && <span className="text-[14px] font-bold">{a.owner_name}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ParkingLot({ ctx }: { ctx: PhaseProps['ctx'] }) {
  const { state, act } = ctx
  const [text, setText] = useState('')
  const countId = useId()
  return (
    <form
      className="mt-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (text.trim() && (await act('add_topic', { p_board: state.board_id, p_text: text })))
          setText('')
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="Add a topic to the end of the queue"
          aria-describedby={countId}
          value={text}
          maxLength={TOPIC_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a topic"
          className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line bg-panel px-3 text-[15px]"
        />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </div>
      <p id={countId} className="mt-1 text-[13px] text-muted">
        {text.length} of {TOPIC_MAX} characters
      </p>
    </form>
  )
}
