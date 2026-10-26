import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
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
import { useAtZero, useCountdown } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import { ActionItem, DiscussedColumn, QueueColumn } from './BoardColumns'
import {
  ACCENT_CHIP,
  ACTION_MAX,
  ActionCount,
  BoardFrame,
  CHIP,
  Eyebrow,
  FILL_LEFT,
  FILL_RIGHT,
  FOCUS_TITLE,
  SessionTime,
  TimerButtons,
  type PhaseProps,
  UP_NEXT_CHIP,
  useLiveNote,
  useRefocus,
} from './common'
import { DownloadsButton } from './Downloads'
import { OwnerField, ownerName } from './OwnerField'
import { useSettledBoard } from './StageSnapshot'
import { TopicEditor } from './TopicTools'

const CHOICES: { value: ExtendVote['choice']; label: string }[] = [
  { value: 'keep', label: 'Keep going' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'move_on', label: 'Move on' },
]

/** The stage's page heading when no topic is up next. */
const STAGE_TITLE = 'text-[36px] leading-tight font-extrabold'
/** A stage button whose press is still on its way: it keeps focus and does nothing. */
const BUSY = 'aria-disabled:cursor-wait aria-disabled:opacity-60'
/** How long a pressed stage button waits for the stage to change before it works again. */
const PRESS_MS = 8000
/**
 * Refusals that mean the stage changed before the press arrived, usually from the facilitator's
 * other tab. The board already shows the change and the live line says it, so no banner.
 */
const STALE_PRESS = { quiet: ['wrong_phase', 'topic_unavailable', 'no_current_topic', 'conflict'] }

/** What someone has typed into a topic's action form, kept when the form moves (Next topic). */
interface Draft {
  text: string
  owner: string
}
interface Forms {
  drafts: Record<string, Draft>
  setDraft: (topicId: string, draft: Draft) => void
  /** The action field that has focus, so a form that replaces it can take the focus back. */
  typing: RefObject<{ topic: string; field: 'text' | 'owner' } | null>
  /** The topic whose action form has focus, if any. */
  focused: string | null
  setFocused: (topicId: string | null) => void
}
const EMPTY_DRAFT: Draft = { text: '', owner: '' }

/**
 * Discuss as the board: To discuss on the left, the stage in the middle, Discussed on the right,
 * under a one-line toolbar with progress, people and downloads. Built for a 1280 x 720 Teams share.
 */
export default function Discuss({ ctx: live, remaining: liveRemaining }: PhaseProps) {
  const now = useNow(1000)
  // The stage and both columns show the last board whose tables agree (see useSettledBoard).
  const { ctx, held } = useSettledBoard(live, now)
  const heldRemaining = useCountdown(ctx.state, ctx.board.offsetMs)
  const remaining = held ? heldRemaining : liveRemaining
  const { board, state, isFacilitator, act } = ctx
  const { topics, extendRounds } = board.data
  // The live line: a repeat (a second extension) is read out too.
  const [note, setNote] = useLiveNote()
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
  // A closed vote's result stays on screen for 10 s. At zero only this clock's own vote shows: an
  // earlier vote on the topic (the one that extended it) would say "Voting closed" as one opens.
  const recentlyClosed = last?.closed_at ? nowServer - Date.parse(last.closed_at) < 10_000 : false
  const thisClocks =
    last !== undefined &&
    state.phase_ends_at !== null &&
    Date.parse(last.opened_at) >= Date.parse(state.phase_ends_at) - 1000
  const shownRound =
    round ?? (last && (remaining === 0 ? thisClocks : recentlyClosed) ? last : undefined)
  const lastDiscussed = discussed.at(-1)
  // The topic that last left the stage, as this browser saw it go. Skip and Defer leave the last
  // discussed topic as it was, so it is not always that one. A browser that has seen nothing leave
  // yet (it just loaded) takes the last discussed topic. The server keeps no record of this.
  const [lastLeft, setLastLeft] = useState<string | null>(null)
  const leftTopic = topics.find((t) => t.id === (lastLeft ?? lastDiscussed?.id))
  // A Move on vote takes the topic off stage on the server; its result stays up until the next
  // topic starts, so the facilitator can still override it. Rounds force-closed have no counts.
  // Once another topic has been on stage (skipped or deferred since), the result has gone with it:
  // Extend anyway would bring back a topic that left two topics ago.
  const lastDiscussedRound = lastDiscussed && lastRound(extendRounds, lastDiscussed.id)
  const votedSince = (r: ExtendRound) =>
    r.closed_at !== null &&
    extendRounds.some(
      (o) => o.topic_id !== r.topic_id && Date.parse(o.opened_at) > Date.parse(r.closed_at ?? ''),
    )
  const movedOn =
    !current &&
    leftTopic !== undefined &&
    leftTopic === lastDiscussed &&
    lastDiscussedRound?.result === 'move_on' &&
    lastDiscussedRound.keep_count !== null &&
    !votedSince(lastDiscussedRound)
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

  // Discuss opens at the top of the page, with the header and the stage on the share, wherever
  // the agenda was scrolled to when the facilitator pressed Start discussing.
  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo(0, 0)
  }, [])

  // One polite line when an extend vote opens or closes, or a topic starts, finishes, is skipped
  // or deferred; never per second. The panels that show these results are not live regions, as
  // regions added with their text already in them are read out unreliably.
  const moveKey = [
    ...topics.map((t) => `${t.id}:${t.status}`),
    ...extendRounds.map((r) => `${r.id}:${r.closed_at ? r.result : 'open'}`),
  ].join()
  const [seen, setSeen] = useState({ key: moveKey, topics, rounds: extendRounds })
  if (seen.key !== moveKey) {
    setSeen({ key: moveKey, topics, rounds: extendRounds })
    const status = new Map(topics.map((t) => [t.id, t.status]))
    const left = seen.topics.find(
      (t) => t.status === 'discussing' && status.get(t.id) !== 'discussing',
    )
    if (left) setLastLeft(left.id)
    const message = boardMoves(
      seen,
      { topics, rounds: extendRounds },
      state.settings.extend_s * 1000,
    )
    if (message) setNote(message)
  }

  // The last 5 minutes: said once in the live line, and shown in the toolbar so it adds no height.
  const warning =
    minutesLeft === null || minutesLeft > 5
      ? null
      : minutesLeft <= 0
        ? `Past the planned ${state.planned_minutes} min. Time to wrap up.`
        : `About ${Math.max(1, Math.ceil(minutesLeft))} min left. Time to wrap up.`
  const [warned, setWarned] = useState(false)
  if (warning && !warned) {
    setWarned(true)
    setNote(warning)
  }

  // Action drafts live here, so Next topic or a Move on result does not throw away what someone
  // was typing for the topic that just left the stage.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const typing = useRef<{ topic: string; field: 'text' | 'owner' } | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  // A form removed with the focus in it never hears its blur; the next focus anywhere else says
  // nobody is in one any more.
  useEffect(() => {
    const leave = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-action-form]')) return
      typing.current = null
      setFocused(null)
    }
    document.addEventListener('focusin', leave)
    return () => document.removeEventListener('focusin', leave)
  }, [])
  const forms: Forms = {
    drafts,
    typing,
    focused,
    setFocused,
    setDraft: (topicId, draft) => setDrafts((all) => ({ ...all, [topicId]: draft })),
  }

  // One press at a time on the stage: a second press (a double-click, or Defer then Skip) waits
  // until the stage has changed, so it never lands on a topic nobody has seen on stage yet.
  const press = useStagePress(act, `${current?.id}|${round?.id}|${movedOn?.id}`, now)

  // A pressed stage button often leaves with the stage's old content (Next topic, Skip, Start the
  // clock, Call vote now). Focus then moves to the stage heading instead of the top of the page;
  // after a Move on result, to the result, so Extend anyway is the next Tab stop.
  // Losing the facilitator role takes the stage controls away too.
  const { area: stage, target: heading } = useRefocus<HTMLElement, HTMLElement>(
    `${current?.id}|${round?.id}|${shownRound?.id}|${isFacilitator}`,
  )
  const wrapUp = () => press.run('start_phase', { p_board: state.board_id, p_phase: 'wrapup' })

  const stageContent = current ? (
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
      press={press}
      forms={forms}
      carry={
        // A draft, or a form someone is in, for the topic that just left (auto-start next).
        leftTopic &&
        leftTopic.id !== current.id &&
        (focused === leftTopic.id ||
          (drafts[leftTopic.id]?.text ?? '').trim() ||
          (drafts[leftTopic.id]?.owner ?? '').trim())
          ? leftTopic
          : undefined
      }
    />
  ) : (
    <>
      {/* The topic is not repeated here: it is last in Discussed, and the live line names it. */}
      {movedOn && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-2 border-line-strong px-4 py-3">
          <p
            ref={heading as RefObject<HTMLParagraphElement | null>}
            tabIndex={-1}
            className="min-w-0 flex-1 text-[17px]"
          >
            <b className="block">The group chose to move on.</b>
            {movedOn.keep_count} keep going, {movedOn.neutral_count} neutral,{' '}
            {movedOn.move_on_count} move on.
          </p>
          {isFacilitator && (
            <Button
              variant="secondary"
              className={BUSY}
              aria-disabled={press.busy || undefined}
              onClick={() => press.run('extend_topic', { p_board: state.board_id })}
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
        heading={movedOn ? undefined : heading}
        press={press}
        onWrapUp={wrapUp}
      />
      {leftTopic && (
        <ActionsFor
          ctx={ctx}
          topic={leftTopic}
          forms={forms}
          label="Actions from the last topic"
          list={false}
        />
      )}
    </>
  )

  return (
    <BoardFrame
      progress={
        <>
          <p className="text-[15px] font-bold">{discussProgress(topics)}</p>
          <SessionTime
            state={state}
            nowMs={nowServer}
            extra={
              warning === null &&
              fit !== null &&
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
              ))
            }
          />
          {warning && (
            // Words, not color alone; in the toolbar, so the stage keeps its room on the share.
            <p className="rounded-md border-2 border-urgent px-2.5 py-1 text-[15px] font-bold">
              {warning}
            </p>
          )}
        </>
      }
      tools={
        <>
          {/* Between topics Start wrap-up is on the stage already. */}
          {warning && isFacilitator && current && (
            <Button className={BUSY} aria-disabled={press.busy || undefined} onClick={wrapUp}>
              Start wrap-up
            </Button>
          )}
          <PeopleButton ctx={ctx} />
          <DownloadsButton data={board.data} />
        </>
      }
      left={<QueueColumn ctx={ctx} totals={totals} onNote={setNote} className={FILL_LEFT} />}
      stageLabel="Discussing"
      stageRef={stage}
      stage={stageContent}
      right={<DiscussedColumn ctx={ctx} totals={totals} onNote={setNote} className={FILL_RIGHT} />}
      note={note}
    />
  )
}

interface Press {
  busy: boolean
  run: (fn: string, args: Record<string, unknown>) => void
}

/**
 * Stage presses that change the stage (Next topic, Defer, Skip, Start the clock, Call vote now,
 * Extend anyway, Re-vote, Start wrap-up). The facilitator's own tab can take a second or two to
 * show the change, so until the stage `key` changes (or the call fails, or PRESS_MS passes) the
 * buttons stay focusable but do nothing. Otherwise a second press acts on the next topic.
 */
function useStagePress(act: PhaseProps['ctx']['act'], key: string, nowMs: number): Press {
  const [pending, setPending] = useState<{ key: string; at: number } | null>(null)
  const inFlight = useRef(false)
  if (pending && (pending.key !== key || nowMs - pending.at > PRESS_MS)) setPending(null)
  useEffect(() => {
    if (!pending) inFlight.current = false
  }, [pending])
  return {
    busy: pending !== null,
    run: (fn, args) => {
      if (inFlight.current || pending) return
      inFlight.current = true
      setPending({ key, at: Date.now() })
      void act(fn, args, STALE_PRESS).then((ok) => {
        if (!ok) setPending(null)
      })
    },
  }
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
  press,
  forms,
  carry,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  votes: number
  remaining: number | null
  round: ExtendRound | undefined
  shownRound: ExtendRound | undefined
  roundLeft: number | null
  heading: RefObject<HTMLElement | null>
  press: Press
  forms: Forms
  /** The last topic, while someone has an action draft for it or is in its form. */
  carry: Topic | undefined
}) {
  const { state, isFacilitator } = ctx
  const [editing, setEditing] = useState(false)
  // The role can move while the editor is open: a participant is never offered an edit.
  if (editing && !isFacilitator) setEditing(false)
  const editId = useId()
  // Save, Cancel and Escape put focus back on the Edit button.
  const refocus = useRef(false)
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      document.getElementById(editId)?.focus()
    }
  }, [editing, editId])
  // An extended topic's clock runs for the extension time; a topic brought back after an extension
  // restarts at the full discussion time. Time added past that makes the clock longer: "of" names
  // the longest it has been since the clock last started, so it does not count down with the
  // digits. The start time comes with the clock in one row, so an extension's restart resets it
  // even while the topic's extension count is still on its way; a pause (no start time) keeps it.
  const segment = state.timer_started_at
  const [peak, setPeak] = useState({ segment, ms: 0 })
  const restarted = segment !== null && peak.segment !== segment
  const peakMs = restarted ? 0 : peak.ms
  if (restarted || (remaining ?? 0) > peakMs)
    setPeak({ segment: segment ?? peak.segment, ms: Math.max(peakMs, remaining ?? 0) })
  const totalMs = Math.max(
    remaining ?? 0,
    peakMs,
    (topic.extensions > 0 ? state.settings.extend_s : state.settings.discuss_s) * 1000,
  )
  const outcome = (p_outcome: 'discussed' | 'deferred' | 'skipped') =>
    press.run('next_topic', { p_board: state.board_id, p_outcome })
  const busy = { className: BUSY, 'aria-disabled': press.busy || undefined }
  // A long topic or the extend vote shrinks the ring; the type stays at 44 px.
  const ring = (
    <RingTimer
      remaining={remaining}
      totalMs={totalMs}
      paused={state.paused_remaining_ms !== null}
      size={stageRingSize(topic.text, shownRound !== undefined, remaining ?? totalMs)}
    />
  )
  const chips = (
    <div className="flex flex-wrap gap-2">
      <span className={ACCENT_CHIP}>DISCUSSING NOW</span>
      <span className={CHIP}>{plural(votes, 'vote')}</span>
      {topic.extensions > 0 && <span className={CHIP}>Extended ×{topic.extensions}</span>}
    </div>
  )
  const words = (
    <>
      {/* While editing, the editor takes the heading's place on the share; the heading stays for
          screen readers and as the focus target. During the vote a long topic shows three lines
          (all of it for screen readers), so the vote stays on the share. */}
      <h1
        ref={heading as RefObject<HTMLHeadingElement | null>}
        tabIndex={-1}
        dir="auto"
        className={editing ? 'sr-only' : `${FOCUS_TITLE} ${shownRound ? 'line-clamp-3' : ''}`}
      >
        {topic.text}
      </h1>
      {editing && (
        <TopicEditor
          ctx={ctx}
          topic={topic}
          large
          onDone={() => {
            refocus.current = true
            setEditing(false)
          }}
        />
      )}
      <p className="mt-2 text-[17px] text-muted">
        Raised by{' '}
        <b className="text-ink">
          <bdi>{topic.author_name}</bdi>
        </b>
        , who starts the conversation
      </p>
    </>
  )
  return (
    <>
      {topic.text.length > LONG_TOPIC ? (
        // A long topic runs full width under the ring, which floats beside the badges and the
        // topic's first lines, and the lines follow its circle. On a narrow stage the ring goes
        // under the topic instead.
        <div className="flex flex-col gap-3 @lg:flow-root">
          <div className="order-last mx-auto @lg:float-right @lg:mb-2 @lg:ml-6 @lg:[shape-margin:16px] @lg:[shape-outside:circle(50%)]">
            {ring}
          </div>
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
              {...busy}
              onClick={() => press.run('open_extend_round', { p_board: state.board_id })}
            >
              Call vote now
            </Button>
          )}
          <Button {...busy} onClick={() => outcome('discussed')}>
            Next topic
          </Button>
          {/* During the 15-second vote the clock and Next topic are enough, and one row of them
              stays on a 720 px share under the vote. */}
          {!round && (
            <>
              <Button variant="ghost" {...busy} onClick={() => outcome('deferred')}>
                Defer to later
              </Button>
              <Button variant="ghost" {...busy} onClick={() => outcome('skipped')}>
                Skip
              </Button>
            </>
          )}
          {!editing && !round && (
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
      <ActionsFor ctx={ctx} topic={topic} forms={forms} />
      {carry && (
        <ActionsFor
          ctx={ctx}
          topic={carry}
          forms={forms}
          label="Actions from the last topic"
          list={false}
        />
      )}
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
  press,
  onWrapUp,
}: {
  ctx: PhaseProps['ctx']
  next: Topic | undefined
  votes: number
  skipped: number
  heading: RefObject<HTMLElement | null> | undefined
  press: Press
  onWrapUp: () => void
}) {
  const { state, isFacilitator } = ctx
  const disabled = press.busy || undefined
  const h1Ref = heading as RefObject<HTMLHeadingElement | null> | undefined
  if (!next) {
    const hint: ReactNode = isFacilitator ? (
      skipped > 0 ? (
        'Bring back a skipped topic from To discuss, or start wrap-up.'
      ) : (
        'Start wrap-up to collect take-aways and download the results.'
      )
    ) : (
      <b className="text-ink">Waiting for the facilitator to start wrap-up.</b>
    )
    return (
      <>
        <h1 ref={h1Ref} tabIndex={-1} className={STAGE_TITLE}>
          {skipped > 0 ? 'No topics left in the queue' : 'Every topic has been discussed'}
        </h1>
        <p className="mt-2 text-[17px] text-muted">{hint}</p>
        {isFacilitator && (
          <Button className={`mt-6 h-14 px-8 ${BUSY}`} aria-disabled={disabled} onClick={onWrapUp}>
            Start wrap-up
          </Button>
        )}
      </>
    )
  }
  return (
    <>
      {/* The start button sits beside UP NEXT, so a long topic never pushes it off the share. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={UP_NEXT_CHIP}>UP NEXT</span>
        {isFacilitator && (
          <Button
            className={`h-14 px-8 text-[17px] ${BUSY}`}
            aria-disabled={disabled}
            onClick={() => press.run('start_discussion', { p_board: state.board_id })}
          >
            Start the {formatClock(state.settings.discuss_s * 1000)} clock
          </Button>
        )}
      </div>
      <h1 ref={h1Ref} tabIndex={-1} dir="auto" className={`mt-3 ${FOCUS_TITLE}`}>
        {next.text}
      </h1>
      <p className="mt-2 text-[17px] text-muted">
        Raised by{' '}
        <b className="text-ink">
          <bdi>{next.author_name}</bdi>
        </b>{' '}
        · {plural(votes, 'vote')}
      </p>
      {isFacilitator ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className={BUSY}
            aria-disabled={disabled}
            onClick={() => press.run('revote', { p_board: state.board_id })}
          >
            Re-vote remaining topics
          </Button>
          <Button variant="ghost" className={BUSY} aria-disabled={disabled} onClick={onWrapUp}>
            Start wrap-up
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[17px] font-bold">
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
  const { board, state, userId, isFacilitator, act } = ctx
  const now = useNow(5000)
  const panel = useRef<HTMLElement>(null)
  const round = board.data.extendRounds.find((r) => r.id === roundId)
  const closed = round ? round.closed_at !== null : true
  // The vote lasts 15 seconds. On a phone or at a high zoom it can open below the fold, so it is
  // brought into view, unless someone is typing (an action), whose field would scroll away.
  useEffect(() => {
    const el = panel.current
    if (!el || closed) return
    const box = el.getBoundingClientRect()
    const field = document.activeElement
    const typing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    if (!typing && (box.top < 0 || box.bottom > window.innerHeight))
      el.scrollIntoView({ block: 'nearest' })
  }, [roundId, closed])
  if (!round) return null
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
    <section
      ref={panel}
      aria-label="Extend vote"
      className="rounded-2xl border-2 border-line-strong bg-panel p-5"
    >
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
      {/* Side by side when the stage column is wide enough, stacked when it is not. Once the vote
          closes the buttons stay focusable, so whoever cast the last vote keeps their place. */}
      <div className="mt-4 grid gap-2 @lg:grid-cols-3">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-disabled={closed || undefined}
            aria-pressed={mine?.choice === c.value}
            onClick={() => {
              if (!closed) void act('cast_extend_vote', { p_round: roundId, p_choice: c.value })
            }}
            className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border-2 px-4 text-[17px] font-bold aria-disabled:cursor-default ${mine?.choice === c.value ? 'border-teal bg-teal-soft' : 'border-line'}`}
          >
            <span>
              {c.label}
              {mine?.choice === c.value && (
                <span className="block text-[14px] text-teal">✓ Your vote</span>
              )}
            </span>
            {/* Tallies stay hidden until the round closes; nothing about them is in the page before then. */}
            {closed ? (
              <span className="text-[22px] font-extrabold">
                {counts[c.value]}
                <span className="sr-only"> {counts[c.value] === 1 ? 'vote' : 'votes'}</span>
              </span>
            ) : (
              <span className="text-[22px] font-extrabold" aria-hidden="true">
                ?
              </span>
            )}
          </button>
        ))}
      </div>
      {closed && (
        <p className="mt-4 text-[17px] font-bold">
          {round.result !== 'extend'
            ? 'The group chose to move on.'
            : `${groupExtended ? 'The group chose to keep going' : 'The facilitator extended it'}: the clock restarts at ${formatClock(state.settings.extend_s * 1000)}.`}
        </p>
      )}
      {/* Not on the facilitator's stage, which needs the room for Next topic on the share. */}
      {!closed && !isFacilitator && (
        <p className="mt-3 text-[14px] text-muted">
          Results show when everyone has voted or the 15 seconds are up.
        </p>
      )}
    </section>
  )
}

/**
 * Add an action to a topic. On stage the topic's actions are listed underneath; between topics
 * only the form shows, as the last topic's actions are listed under it in Discussed. The draft
 * lives in Discuss, so the form for the same topic keeps it, and the focus, when it moves.
 */
function ActionsFor({
  ctx,
  topic,
  forms,
  label = 'Actions from this topic',
  list = true,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  forms: Forms
  label?: string
  list?: boolean
}) {
  const { board, state, act } = ctx
  const topicId = topic.id
  const { text, owner } = forms.drafts[topicId] ?? EMPTY_DRAFT
  const textRef = useRef<HTMLInputElement>(null)
  const ownerRef = useRef<HTMLInputElement>(null)
  const { typing } = forms
  // This form replaced the one someone was typing in (Next topic, a Move on result): focus
  // returns to the same field, with the caret at the end, instead of the stage heading.
  useEffect(() => {
    const was = typing.current
    const focused = document.activeElement
    if (was?.topic !== topicId || (focused !== null && focused !== document.body)) return
    const field = (was.field === 'text' ? textRef : ownerRef).current
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [typing, topicId])
  const actions = board.data.actions.filter((a) => a.topic_id === topicId)
  const full = board.data.actions.length >= ACTION_MAX
  const track = (field: 'text' | 'owner') => ({
    onFocus: () => {
      typing.current = { topic: topicId, field }
      forms.setFocused(topicId)
    },
    onBlur: () => {
      typing.current = null
      forms.setFocused(null)
    },
  })
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || full) return
    if (
      await act('add_action', {
        p_board: state.board_id,
        p_text: text,
        p_owner_name: ownerName(owner),
        p_topic: topicId,
      })
    )
      forms.setDraft(topicId, EMPTY_DRAFT)
  }
  return (
    <div className="mt-5">
      <Eyebrow>{label}</Eyebrow>
      <form onSubmit={add} data-action-form className="mt-2 flex flex-wrap gap-2">
        <input
          ref={textRef}
          aria-label="New action"
          value={text}
          maxLength={140}
          dir="auto"
          onChange={(e) => forms.setDraft(topicId, { text: e.target.value, owner })}
          {...track('text')}
          placeholder="Add an action"
          className="h-12 min-w-0 grow basis-60 rounded-xl border-2 border-line-strong bg-panel px-3 text-[16px]"
        />
        <OwnerField
          inputRef={ownerRef}
          value={owner}
          onChange={(v) => forms.setDraft(topicId, { text, owner: v })}
          {...track('owner')}
          people={board.data.participants}
          className="h-12 rounded-xl"
        />
        <Button
          type="submit"
          className="h-12 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          aria-disabled={full || undefined}
        >
          Add action
        </Button>
      </form>
      <ActionCount count={board.data.actions.length} />
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
