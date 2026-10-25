import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import {
  boardMoves,
  boardTotals,
  cards,
  discussProgress,
  extendOutcome,
  lastRound,
  LONG_TOPIC,
  openRound,
  plural,
  sessionMinutesLeft,
  stageRingSize,
  topicsThatFit,
} from '../../lib/session'
import { callWhenDue } from '../../lib/retry'
import { formatClock, isPresent } from '../../lib/time'
import type { ExtendRound, ExtendVote, Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useMediaQuery } from '../../state/useMediaQuery'
import { useNow } from '../../state/useNow'
import { ActionItem, DiscussedColumn, QueueColumn } from './BoardColumns'
import { Eyebrow, TimerButtons, type PhaseProps } from './common'
import { DownloadsButton } from './Downloads'
import { OwnerField, ownerName } from './OwnerField'
import { TopicEditor } from './TopicTools'

const CHOICES: { value: ExtendVote['choice']; label: string }[] = [
  { value: 'keep', label: 'Keep going' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'move_on', label: 'Move on' },
]

// Chips on the stage. In dark mode --surface equals --panel, so they take --line to stand out.
const CHIP = 'rounded-md bg-surface px-2.5 py-1 text-[14px] font-bold dark:bg-line'

/**
 * Discuss as the board: To discuss on the left, the stage in the middle, Discussed on the right,
 * under a one-line toolbar with progress, people and downloads. Built for a 1280 x 720 Teams share.
 */
export default function Discuss({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator, act } = ctx
  const { topics, extendRounds } = board.data
  // The live line. Each message is a new node, so a repeat (a second extension) is read out too.
  const [note, setNoteState] = useState({ text: '', n: 0 })
  const setNote = (text: string) => setNoteState((last) => ({ text, n: last.n + 1 }))
  const now = useNow(1000)
  const nowServer = now + board.offsetMs
  const current = topics.find((t) => t.id === state.current_topic_id)
  const queue = cards(topics).filter((t) => t.status === 'open')
  const skipped = cards(topics).filter((t) => t.status === 'skipped')
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const totals = boardTotals(board.data.votes, topics, state.base_round)
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

  // One polite line when an extend vote closes, or a topic starts, finishes, is skipped or
  // deferred; never per second. The panels that show these results are not live regions, as
  // regions added with their text already in them are read out unreliably.
  const moveKey = [
    ...topics.map((t) => `${t.id}:${t.status}`),
    ...extendRounds.map((r) => `${r.id}:${r.closed_at ? r.result : 'open'}`),
  ].join()
  const [seen, setSeen] = useState({ key: moveKey, topics, rounds: extendRounds })
  if (seen.key !== moveKey) {
    setSeen({ key: moveKey, topics, rounds: extendRounds })
    const message = boardMoves(
      seen,
      { topics, rounds: extendRounds },
      state.settings.extend_s * 1000,
    )
    if (message) setNote(message)
  }

  // A pressed stage button often leaves with the stage's old content (Next topic, Skip, Start the
  // clock, Call vote now). Focus then moves to the stage heading instead of the top of the page.
  const stage = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusInStage = useRef(false)
  useEffect(() => {
    const track = (e: FocusEvent) => {
      focusInStage.current = !!stage.current?.contains(e.target as Node)
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [])
  const stageKey = `${current?.id}|${round?.id}|${shownRound?.id}`
  useEffect(() => {
    const active = document.activeElement
    if (focusInStage.current && (active === null || active === document.body))
      heading.current?.focus()
  }, [stageKey])

  // Focus and reading order follow the screen: To discuss, the stage, then Discussed side by side
  // from 1024 px, and the stage first when the columns stack on a phone.
  const wide = useMediaQuery('(min-width: 64rem)')
  const queueColumn = (
    <div key="queue" className="relative min-w-0">
      <QueueColumn
        ctx={ctx}
        totals={totals}
        onNote={setNote}
        className="lg:absolute lg:inset-0 lg:overflow-y-auto"
      />
    </div>
  )
  const discussedColumn = (
    <div key="discussed" className="relative min-w-0 lg:col-span-2 xl:col-span-1">
      <DiscussedColumn
        ctx={ctx}
        totals={totals}
        onNote={setNote}
        className="xl:absolute xl:inset-0 xl:overflow-y-auto"
      />
    </div>
  )
  const stageColumn = (
    <section
      key="stage"
      ref={stage}
      aria-label="Discussing"
      className="@container min-w-0 rounded-2xl border-2 border-teal bg-panel p-5"
    >
      {current ? (
        <Stage
          key={current.id}
          ctx={ctx}
          topic={current}
          votes={totals.get(current.id) ?? 0}
          remaining={remaining}
          round={round}
          shownRound={shownRound}
          roundLeft={roundLeft}
          heading={heading}
        />
      ) : (
        <>
          {/* The topic is not repeated here: it is last in Discussed, and the live line names it.
              That keeps a long Up next topic and its start button on the share. */}
          {movedOn && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-2 border-teal px-4 py-3">
              <p className="flex-1 text-[17px]">
                <b>The group chose to move on.</b> {movedOn.keep_count} keep going,{' '}
                {movedOn.neutral_count} neutral, {movedOn.move_on_count} move on.
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
          <UpNext
            ctx={ctx}
            next={queue[0]}
            votes={queue[0] ? (totals.get(queue[0].id) ?? 0) : 0}
            skipped={skipped.length}
            heading={heading}
          />
          {lastDiscussed && (
            <ActionsFor
              ctx={ctx}
              topicId={lastDiscussed.id}
              label="Actions from the last topic"
              list={false}
            />
          )}
        </>
      )}
    </section>
  )

  const elapsed = minutesLeft === null ? 0 : state.planned_minutes - minutesLeft
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-[15px] font-bold">{discussProgress(topics)}</p>
          {minutesLeft !== null && (
            <>
              <div
                className="h-2.5 w-[180px] overflow-hidden rounded-full bg-line"
                aria-hidden="true"
              >
                <div
                  className="h-full bg-teal"
                  style={{ width: `${Math.min(100, (elapsed / state.planned_minutes) * 100)}%` }}
                />
              </div>
              <p className="text-[15px] text-muted">
                <b className="text-ink">
                  {Math.round(elapsed)} of {state.planned_minutes} min
                </b>
                {fit !== null &&
                  (fit === 0 ? (
                    ' · no more topics fit'
                  ) : (
                    <>
                      {' · about '}
                      <b className="text-ink">
                        {fit} more {fit === 1 ? 'topic' : 'topics'}
                      </b>{' '}
                      fit
                    </>
                  ))}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeopleButton ctx={ctx} />
          <DownloadsButton data={board.data} />
        </div>
      </div>
      {minutesLeft !== null && minutesLeft <= 5 && (
        // One line, so the extend vote and the action form stay on a 720 px share.
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-4 rounded-xl border-2 border-urgent px-4 py-1"
        >
          <p className="flex-1 py-2 text-[16px] font-bold">
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
      {/* Beside the stage the side columns are as tall as its row and scroll on their own. Three
          columns from 1280 px; from 1024 px Discussed runs under To discuss and the stage. */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)] xl:grid-cols-[minmax(250px,1fr)_minmax(0,2.25fr)_minmax(250px,1fr)]">
        {wide
          ? [queueColumn, stageColumn, discussedColumn]
          : [stageColumn, queueColumn, discussedColumn]}
      </div>
      <p role="status" className="sr-only">
        <span key={note.n}>{note.text}</span>
      </p>
    </main>
  )
}

/** The topic on stage: badges, the topic as the page heading, the ring, controls and actions. */
function Stage({
  ctx,
  topic,
  votes,
  remaining,
  round,
  shownRound,
  roundLeft,
  heading,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  votes: number
  remaining: number | null
  round: ExtendRound | undefined
  shownRound: ExtendRound | undefined
  roundLeft: number | null
  heading: RefObject<HTMLHeadingElement | null>
}) {
  const { state, isFacilitator, act } = ctx
  const [editing, setEditing] = useState(false)
  const editId = useId()
  // Save, Cancel and Escape put focus back on the Edit button.
  const refocus = useRef(false)
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      document.getElementById(editId)?.focus()
    }
  }, [editing, editId])
  // A topic brought back after an extension restarts at the full discussion time.
  const totalMs = Math.max(
    remaining ?? 0,
    (topic.extensions > 0 ? state.settings.extend_s : state.settings.discuss_s) * 1000,
  )
  const outcome = (p_outcome: 'discussed' | 'deferred' | 'skipped') =>
    act('next_topic', { p_board: state.board_id, p_outcome })
  // A long topic or the extend vote shrinks the ring; the type stays at 44 px.
  const ring = (
    <RingTimer
      remaining={remaining}
      totalMs={totalMs}
      paused={state.paused_remaining_ms !== null}
      size={stageRingSize(topic.text, shownRound !== undefined, totalMs)}
    />
  )
  const chips = (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-md bg-teal-soft px-2.5 py-1 text-[14px] font-extrabold tracking-[0.08em] text-teal">
        DISCUSSING NOW
      </span>
      <span className={CHIP}>{plural(votes, 'vote')}</span>
      {topic.extensions > 0 && <span className={CHIP}>Extended ×{topic.extensions}</span>}
    </div>
  )
  const words = (
    <>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[44px] leading-[1.08] font-extrabold tracking-tight break-words"
      >
        {topic.text}
      </h1>
      {editing && (
        <div className="mt-3">
          <TopicEditor
            ctx={ctx}
            topic={topic}
            onDone={() => {
              refocus.current = true
              setEditing(false)
            }}
          />
        </div>
      )}
      <p className="mt-2 text-[17px] text-muted">
        Raised by <b className="text-ink">{topic.author_name}</b>, who starts the conversation
      </p>
    </>
  )
  return (
    <>
      {topic.text.length > LONG_TOPIC ? (
        // A long topic runs full width under the ring, which floats beside the badges and the
        // topic's first lines. On a narrow stage the ring goes under the topic instead.
        <div className="flex flex-col gap-3 @lg:flow-root">
          <div className="order-last mx-auto @lg:float-right @lg:mb-2 @lg:ml-6">{ring}</div>
          {chips}
          <div className="min-w-0 @lg:mt-3">{words}</div>
        </div>
      ) : (
        <>
          {chips}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <div className="min-w-0 grow basis-64">{words}</div>
            {/* Centered when it wraps under the topic, as on a phone. */}
            <div className="mx-auto">{ring}</div>
          </div>
        </>
      )}
      {shownRound && (
        <div className="mt-4">
          <ExtendPanel ctx={ctx} roundId={shownRound.id} roundLeft={roundLeft} />
        </div>
      )}
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
          <Button onClick={() => outcome('discussed')}>Next topic</Button>
          <Button variant="ghost" onClick={() => outcome('deferred')}>
            Defer to later
          </Button>
          <Button variant="ghost" onClick={() => outcome('skipped')}>
            Skip
          </Button>
          {!editing && (
            <Button
              id={editId}
              variant="ghost"
              aria-label={`Edit "${topic.text}"`}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
        </div>
      )}
      <ActionsFor ctx={ctx} topicId={topic.id} />
    </>
  )
}

/** Between topics: the next topic and the facilitator's start, or the end of the queue. */
function UpNext({
  ctx,
  next,
  votes,
  skipped,
  heading,
}: {
  ctx: PhaseProps['ctx']
  next: Topic | undefined
  votes: number
  skipped: number
  heading: RefObject<HTMLHeadingElement | null>
}) {
  const { state, isFacilitator, act } = ctx
  const wrapUp = () => act('start_phase', { p_board: state.board_id, p_phase: 'wrapup' })
  if (!next)
    return (
      <>
        <h1 ref={heading} tabIndex={-1} className="text-[36px] leading-tight font-extrabold">
          {skipped > 0 ? 'No topics left in the queue' : 'Every topic has been discussed'}
        </h1>
        {isFacilitator && (
          <Button className="mt-6 h-14 px-8" onClick={wrapUp}>
            Start wrap-up
          </Button>
        )}
      </>
    )
  return (
    <>
      <span className={`${CHIP} font-extrabold tracking-[0.08em]`}>UP NEXT</span>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-3 text-[44px] leading-[1.08] font-extrabold tracking-tight break-words"
      >
        {next.text}
      </h1>
      <p className="mt-2 text-[17px] text-muted">
        Raised by <b className="text-ink">{next.author_name}</b> · {plural(votes, 'vote')}
      </p>
      {isFacilitator ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            className="h-14 px-8 text-[17px]"
            onClick={() => act('start_discussion', { p_board: state.board_id })}
          >
            Start the {formatClock(state.settings.discuss_s * 1000)} clock
          </Button>
          <Button variant="ghost" onClick={() => act('revote', { p_board: state.board_id })}>
            Re-vote remaining topics
          </Button>
          <Button variant="ghost" onClick={wrapUp}>
            Start wrap-up
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-[17px] font-bold" aria-live="polite">
          Waiting for the facilitator to start the next topic.
        </p>
      )}
    </>
  )
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
      {/* Side by side when the stage column is wide enough, stacked when it is not. */}
      <div className="mt-4 grid gap-2 @lg:grid-cols-3">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={closed}
            aria-pressed={mine?.choice === c.value}
            onClick={() => act('cast_extend_vote', { p_round: roundId, p_choice: c.value })}
            className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border-2 px-4 text-[17px] font-bold disabled:cursor-default ${mine?.choice === c.value ? 'border-teal bg-teal-soft' : 'border-line'}`}
          >
            <span>
              {c.label}
              {mine?.choice === c.value && (
                <span className="block text-[14px] text-teal">✓ Your vote</span>
              )}
            </span>
            {/* Tallies stay hidden until the round closes; nothing about them is in the page before then. */}
            <span className="text-[22px] font-extrabold">{closed ? counts[c.value] : '?'}</span>
          </button>
        ))}
      </div>
      {closed && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-[17px] font-bold">
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

/**
 * Add an action to a topic. On stage the topic's actions are listed underneath; between topics
 * only the form shows, as the last topic's actions are listed under it in Discussed.
 */
function ActionsFor({
  ctx,
  topicId,
  label = 'Actions from this topic',
  list = true,
}: {
  ctx: PhaseProps['ctx']
  topicId: string
  label?: string
  list?: boolean
}) {
  const { board, state, act } = ctx
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const actions = board.data.actions.filter((a) => a.topic_id === topicId)
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
    <div className="mt-5">
      <Eyebrow>{label}</Eyebrow>
      <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
        <input
          aria-label="New action"
          value={text}
          maxLength={140}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an action"
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
      {list && actions.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {actions.map((a) => (
            <li key={a.id}>
              <ActionItem ctx={ctx} action={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
