import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Button } from '../../components/ui'
import { callWhenDue } from '../../lib/retry'
import {
  boardTotals,
  cards,
  myDots,
  myDotsUsed,
  plural,
  sessionMinutesLeft,
  topicsThatFit,
} from '../../lib/session'
import { formatClock, isPresent } from '../../lib/time'
import type { Action, Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import { ActionList, DiscussedColumn } from './BoardColumns'
import {
  ACCENT_CHIP,
  BoardFrame,
  CARD_TAG,
  CHIP,
  Eyebrow,
  FILL_LEFT,
  FILL_RIGHT,
  FOCUS_TITLE,
  type PhaseProps,
  SessionTime,
  SideColumn,
  STAGE_TITLE,
  TimerButtons,
  UP_NEXT_CHIP,
  useLiveNote,
  useRefocus,
} from './common'
import { DownloadsButton } from './Downloads'
import { agendaTies, voteCounts, type VoteCounts } from './VoteRanking'

// A panel inside the stage. In dark mode --surface equals --panel, so it sits on the ground.
const PANEL = 'rounded-xl bg-surface p-4 dark:bg-ground'
const TIED = 'rounded bg-teal-soft px-2 py-0.5 text-[13px] font-bold text-teal'
/**
 * Refusals that only mean the vote has already moved on: the second half of a double press, or
 * another browser revealing first. The board already shows what happened, so no red banner.
 */
const MOVED_ON = { quiet: ['voting_closed', 'wrong_phase'] }
// The stage's page heading: 32 px when it says what to do, as in every phase, and 44 px for the
// Teams share when it is the topic in focus.

function omit(record: Record<string, number>, key: string): Record<string, number> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

function Dots({
  filled,
  total,
  label,
  size = 'size-4',
}: {
  filled: number
  total: number
  label: string
  size?: string
}) {
  return (
    <span className="flex items-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          // Forced colors drop the fill, so a used dot takes the text color there.
          className={`${size} rounded-full border-2 border-teal ${i < filled ? 'bg-teal forced-colors:bg-[CanvasText]' : ''}`}
        />
      ))}
    </span>
  )
}

/** Your dots on each card, how many are left, and the click that changes them. */
interface Dotting {
  on: (topicId: string) => number
  left: number
  cast: (t: Topic, delta: number) => void
}

/**
 * Vote as the board: the cards stay in To discuss and take dots in place, the stage holds the
 * clock, your dots and how many have finished, and Discussed stays on the right. After the reveal
 * To discuss is the ranked agenda and the stage starts the discussion.
 */
export default function Vote({ ctx, remaining }: PhaseProps) {
  const { board, state, userId, act } = ctx
  const { votes, participants, topics } = board.data
  const revealed = state.votes_revealed_at !== null
  const tieRound = state.vote_round > state.base_round
  const budget = tieRound ? 1 : state.settings.dots
  const used = myDotsUsed(votes, userId, state.vote_round)
  const me = participants.find((p) => p.user_id === userId)
  const now = useNow(5000)
  const nowServer = now + board.offsetMs
  // Matches the server: only people seen in the last 45 s count toward "everyone finished".
  const present = participants.filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
  const finished = present.filter((p) => p.finished_voting).length
  const open = cards(topics).filter((t) => t.status === 'open')
  const ballot = revealed
    ? []
    : tieRound
      ? open.filter((t) => state.tie_topic_ids.includes(t.id))
      : open
  // Nothing about the current round's counts is shown before the reveal, as none is returned.
  const counts = voteCounts(votes, state)
  // Counts show once the main round is revealed, so in a tie-break round the other tie groups
  // keep their TIED badge too.
  const groups = counts ? agendaTies(open, counts) : []
  const tied = new Set([
    ...groups.flat().map((t) => t.id),
    ...(tieRound && !revealed ? state.tie_topic_ids : []),
  ])
  const [note, setNote] = useLiveNote()

  // When the clock runs out, any browser may ask the server to reveal; it checks the deadline.
  useAtZero(remaining, state.phase_ends_at, () => {
    if (!revealed) callWhenDue('reveal_votes', { p_board: state.board_id })
  })

  // Optimistic dots per topic: each click builds on the last value sent, not on whatever the
  // server has echoed back yet, so quick clicks add up. Entries clear once the server agrees.
  const [pending, setPending] = useState<Record<string, number>>({})
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const serverDots = (id: string) => myDots(votes, userId, state.vote_round, id)
  const dotsOn = (id: string) => pending[id] ?? serverDots(id)
  const usedNow =
    ballot.reduce((n, t) => n + dotsOn(t.id), 0) +
    (used - ballot.reduce((n, t) => n + serverDots(t.id), 0))
  // Send in click order: parallel requests can arrive out of order and undo a later click.
  const send = (call: () => Promise<unknown>) => (queue.current = queue.current.then(call))
  const cast = async (t: Topic, delta: number) => {
    const target = dotsOn(t.id) + delta
    setPending((p) => ({ ...p, [t.id]: target }))
    await send(async () => {
      if (!(await act('cast_dots', { p_topic: t.id, p_dots: target })))
        setPending((p) => omit(p, t.id))
    })
  }
  for (const [id, n] of Object.entries(pending)) {
    if (serverDots(id) === n) {
      setPending((p) => omit(p, id))
      break
    }
  }
  // "I'm done" and the facilitator's reveal wait for every dot still being sent: the last
  // "I'm done" reveals the votes, and the server refuses a dot that arrives after that.
  // A second press while the first is on its way does nothing (a double click on the last
  // "I'm done" would otherwise be refused once the first has revealed the votes).
  const pressing = useRef(new Set<string>())
  const once = (key: string, call: () => Promise<unknown>) => {
    if (pressing.current.has(key)) return
    pressing.current.add(key)
    void call().finally(() => pressing.current.delete(key))
  }
  const finish = () =>
    once('finish', () =>
      send(() =>
        act('finish_voting', { p_board: state.board_id, p_done: !me?.finished_voting }, MOVED_ON),
      ),
    )
  const reveal = () =>
    once('reveal', () => send(() => act('reveal_votes', { p_board: state.board_id }, MOVED_ON)))

  // One polite line when the votes are revealed or a tie-break vote opens; never per dot.
  const moment = `${revealed}|${state.vote_round}`
  const [seen, setSeen] = useState(moment)
  if (seen !== moment) {
    setSeen(moment)
    if (revealed) setNote('Voting closed. Here is the agenda.')
    else if (tieRound)
      setNote(`Tie-break vote on ${ballot.length} tied topics: one dot for the one you want first.`)
  }
  // The reveal takes the dot buttons and the stage's buttons away: focus goes to the headings.
  const { area: stageRef, target: stageHeadingRef } = useRefocus<HTMLElement, HTMLHeadingElement>(
    moment,
  )
  const { area: listRef, target: listHeadingRef } = useRefocus<
    HTMLOListElement,
    HTMLHeadingElement
  >(moment)

  const minutesLeft = sessionMinutesLeft(state, nowServer)
  // The vote still to run comes off the time left for topics.
  const fit =
    minutesLeft === null
      ? null
      : topicsThatFit(
          minutesLeft - (revealed ? 0 : (remaining ?? 0) / 60_000),
          state.settings.discuss_s,
          state.settings.wrapup_s,
        )
  const progress = (
    <>
      <p className="text-[15px] font-bold">
        {revealed
          ? `Agenda: ${plural(open.length, 'topic')}`
          : tieRound
            ? `Tie-break: ${plural(ballot.length, 'topic')}`
            : `${plural(ballot.length, 'topic')} on the ballot`}
      </p>
      <SessionTime
        state={state}
        nowMs={nowServer}
        extra={
          fit !== null &&
          (fit === 0 ? (
            ' · no topics fit'
          ) : (
            <>
              {' · about '}
              <b className="text-ink">{plural(fit, 'topic')}</b> fit
            </>
          ))
        }
      />
    </>
  )

  return (
    <BoardFrame
      progress={progress}
      tools={
        <>
          <PeopleButton ctx={ctx} />
          {revealed && <DownloadsButton data={board.data} />}
        </>
      }
      left={
        <TopicsColumn
          ctx={ctx}
          counts={counts}
          ballot={ballot}
          tied={tied}
          revealed={revealed}
          moment={moment}
          dots={{ on: dotsOn, left: budget - usedNow, cast }}
          list={listRef}
          heading={listHeadingRef}
        />
      }
      stageLabel={revealed ? 'Results' : 'Voting'}
      stageRef={stageRef}
      stage={
        revealed && counts ? (
          <ResultsStage
            ctx={ctx}
            open={open}
            counts={counts}
            groups={groups}
            heading={stageHeadingRef}
            onNote={setNote}
            once={once}
          />
        ) : (
          <VotingStage
            ctx={ctx}
            remaining={remaining}
            tieRound={tieRound}
            budget={budget}
            usedNow={usedNow}
            finished={finished}
            present={present.length}
            done={me?.finished_voting ?? false}
            onFinish={finish}
            onReveal={reveal}
            heading={stageHeadingRef}
          />
        )
      }
      right={
        <DiscussedColumn
          ctx={ctx}
          totals={boardTotals(votes, topics, state.base_round)}
          onNote={setNote}
          className={FILL_RIGHT}
        />
      }
      note={note}
    />
  )
}

/** The stage while voting: the clock, your dots, how many have finished, and "I'm done". */
function VotingStage({
  ctx,
  remaining,
  tieRound,
  budget,
  usedNow,
  finished,
  present,
  done,
  onFinish,
  onReveal,
  heading,
}: {
  ctx: PhaseProps['ctx']
  remaining: number | null
  tieRound: boolean
  budget: number
  usedNow: number
  finished: number
  present: number
  done: boolean
  onFinish: () => void
  onReveal: () => void
  heading: RefObject<HTMLHeadingElement | null>
}) {
  const { state, isFacilitator } = ctx
  const { settings } = state
  const revote = state.base_round > 0 && !tieRound
  const totalMs = (tieRound ? 30 : revote ? 60 : settings.vote_s) * 1000
  const longest = Math.max(totalMs, remaining ?? 0)
  return (
    <>
      {/* Badges, heading and the ring share the first row, so "I'm done" and the facilitator's
          buttons stay on a 720 px share. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 grow basis-64">
          <div className="flex flex-wrap gap-2">
            <span className={ACCENT_CHIP}>
              {tieRound ? 'TIE-BREAK' : revote ? 'RE-VOTE' : 'VOTING'}
            </span>
            <span className={CHIP}>Counts hidden until reveal</span>
          </div>
          <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
            {tieRound
              ? 'Tie-break: one dot for the topic you most want first'
              : budget === 1
                ? 'Spend your dot on what you most want to discuss'
                : `Spend your ${budget} dots on what you most want to discuss`}
          </h1>
          <p className="mt-2 text-[16px] text-muted">
            {tieRound
              ? 'Only the tied topics take a dot.'
              : revote
                ? 'A fresh round for the topics still to discuss. Stack dots or spread them out.'
                : 'Stack dots on one topic or spread them out.'}{' '}
            You can change your mind until the clock ends.
          </p>
        </div>
        {remaining !== null && (
          // Centered when it wraps under the heading, as on a phone.
          <div className="mx-auto">
            {/* The 30 s tie-break and the 60 s re-vote turn urgent at 0:10, not from the start. */}
            <RingTimer
              remaining={remaining}
              totalMs={longest}
              paused={state.paused_remaining_ms !== null}
              size={200}
              urgentMs={longest <= 60_000 ? 10_000 : 60_000}
            />
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-3 @lg:grid-cols-2">
        <div className={PANEL}>
          <Eyebrow>Your dots</Eyebrow>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <Dots
                filled={usedNow}
                total={budget}
                label={`${usedNow} of ${budget} dots used`}
                size="size-5"
              />
              <span className="text-[17px] font-bold">{budget - usedNow} left</span>
            </span>
            <Button
              variant={done ? 'secondary' : 'primary'}
              className="h-12"
              aria-pressed={done}
              onClick={onFinish}
            >
              {done ? "I'm done (undo)" : "I'm done"}
            </Button>
          </div>
        </div>
        <div className={PANEL}>
          <Eyebrow>Who has finished</Eyebrow>
          {/* A count only: nobody sees who has finished or what anyone voted for. */}
          <p className="mt-2 text-[17px] font-bold">
            {finished} of {present} finished
          </p>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {Array.from({ length: present }, (_, i) => (
              <span
                key={i}
                className={`h-2.5 flex-1 rounded-full forced-colors:border forced-colors:border-[CanvasText] ${i < finished ? 'bg-teal forced-colors:bg-[CanvasText]' : 'bg-line'}`}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[14px] text-muted">
        Results appear when everyone is done, the clock ends, or the facilitator reveals.
      </p>
      {isFacilitator && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onReveal}>
            Reveal results now
          </Button>
          <TimerButtons ctx={ctx} addSeconds={30} />
        </div>
      )}
      <p className="mt-4 text-[14px] text-muted">
        {tieRound
          ? 'One dot each, on the tied topics only'
          : `${plural(settings.dots, 'dot')} each`}{' '}
        · {formatClock(settings.discuss_s * 1000)} per topic, extended by{' '}
        {formatClock(settings.extend_s * 1000)} · voting on your own topic is{' '}
        {settings.own_vote ? 'on' : 'off'}
      </p>
    </>
  )
}

/**
 * The stage after the reveal, laid out as Discuss's Up next so a long topic and Start discussing
 * stay on a 720 px share: the next topic as the page heading at 44 px, who raised it with its
 * dots, Start discussing, then the facilitator's tie tools. Measured with a 160-character topic,
 * Start discussing ends above 720 px; the tie tools may then sit below it.
 */
function ResultsStage({
  ctx,
  open,
  counts,
  groups,
  heading,
  onNote,
  once,
}: {
  ctx: PhaseProps['ctx']
  open: Topic[]
  counts: VoteCounts
  groups: Topic[][]
  heading: RefObject<HTMLHeadingElement | null>
  onNote: (message: string) => void
  /** Runs a press unless the same one is still on its way. */
  once: (key: string, call: () => Promise<unknown>) => void
}) {
  const { state, isFacilitator, act } = ctx
  const method = state.settings.tie_break
  const first = open[0]
  const dots = (id: string) => counts.main.get(id) ?? 0
  const tieDots = (id: string) => counts.tie.get(id) ?? 0
  // The draw leaves no mark on the board, so this tab remembers it until the stage changes.
  const [drawn, setDrawn] = useState(false)
  // The facilitator's arrows can move any topic; then the agenda no longer follows the dots.
  const byDots = open.every((t, i) => {
    const prev = open[i - 1]
    if (!prev) return true
    return (
      dots(prev.id) > dots(t.id) ||
      (dots(prev.id) === dots(t.id) && tieDots(prev.id) >= tieDots(t.id))
    )
  })
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className={ACCENT_CHIP}>AGENDA</span>
        {first && <span className={UP_NEXT_CHIP}>UP NEXT</span>}
      </div>
      {first ? (
        <>
          <h1 ref={heading} tabIndex={-1} dir="auto" className={`mt-3 ${FOCUS_TITLE}`}>
            {first.text}
          </h1>
          <p className="mt-2 text-[17px] wrap-anywhere text-muted">
            Raised by{' '}
            <b className="text-ink">
              <bdi>{first.author_name}</bdi>
            </b>{' '}
            · {plural(dots(first.id), 'vote')}
            {tieDots(first.id) > 0 && ` + ${tieDots(first.id)} in the tie-break`}
          </p>
        </>
      ) : (
        <>
          <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
            No topics are left to discuss
          </h1>
          <p className="mt-2 text-[17px] text-muted">Anyone can add one in Discuss.</p>
        </>
      )}
      {isFacilitator ? (
        <Button
          className="mt-3 h-12 px-8 text-[17px]"
          onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'discuss' })}
        >
          Start discussing
        </Button>
      ) : (
        <p className="mt-3 text-[17px] font-bold">
          Waiting for the facilitator to start discussing.
        </p>
      )}
      {groups.length > 0 &&
        (isFacilitator ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-line p-4">
            <p className="min-w-0 flex-1 basis-60 text-[15px]">
              <b>{groups.length === 1 ? 'One tie.' : `${groups.length} ties.`}</b>{' '}
              {method === 'drag' && 'Use the arrows to put tied topics in the order you want.'}
              {method === 'random' &&
                (drawn
                  ? 'Ties broken at random. Use the arrows to adjust, or draw again.'
                  : 'Break them with a random draw, or use the arrows.')}
              {method === 'mini_vote' && 'Run a 30-second one-dot vote among tied topics.'}
            </p>
            {method === 'random' && (
              <Button
                variant="secondary"
                onClick={() =>
                  once('draw', async () => {
                    if (await act('break_ties_random', { p_board: state.board_id }, MOVED_ON)) {
                      setDrawn(true)
                      onNote('Ties broken at random.')
                    }
                  })
                }
              >
                {drawn ? 'Draw again' : 'Break ties at random'}
              </Button>
            )}
            {method === 'mini_vote' &&
              groups.map((g) => (
                <Button
                  key={g[0]?.id}
                  variant="secondary"
                  onClick={() =>
                    once('tie vote', () =>
                      act(
                        'start_tie_vote',
                        { p_board: state.board_id, p_topics: g.map((t) => t.id) },
                        MOVED_ON,
                      ),
                    )
                  }
                >
                  Quick vote on {g.length} tied at {dots(g[0]?.id ?? '')}
                </Button>
              ))}
          </div>
        ) : (
          <p className="mt-4 text-[15px] text-muted">
            Topics marked TIED have the same dots. The facilitator puts them in order.
          </p>
        ))}
      <p className="mt-3 text-[14px] text-muted">
        {byDots
          ? 'To discuss is the agenda, ordered by dots, then by any tie-break.'
          : 'To discuss is the agenda. The facilitator has moved topics out of dot order.'}
      </p>
    </>
  )
}

/**
 * Left column, To discuss: the cards take dots in place while voting (in a tie-break, only the
 * tied ones), and after the reveal they are the ranked agenda with totals, ties marked, and the
 * facilitator's arrows. Skipped topics from before a re-vote stay underneath, as in Discuss.
 */
function TopicsColumn({
  ctx,
  counts,
  ballot,
  tied,
  revealed,
  moment,
  dots,
  list,
  heading,
}: {
  ctx: PhaseProps['ctx']
  counts: VoteCounts | null
  ballot: Topic[]
  tied: Set<string>
  revealed: boolean
  /** Changes with the reveal and each tie-break round. */
  moment: string
  dots: Dotting
  list: RefObject<HTMLOListElement | null>
  heading: RefObject<HTMLHeadingElement | null>
}) {
  const { board, state, act } = ctx
  const { topics, votes, actions } = board.data
  const all = cards(topics)
  const open = all.filter((t) => t.status === 'open')
  const skipped = all.filter((t) => t.status === 'skipped')
  const voting = new Set(ballot.map((t) => t.id))
  const earlier = boardTotals(votes, topics, state.base_round)
  const own = (t: Topic) => actions.filter((a) => a.topic_id === t.id)
  const headingId = useId()
  const skippedId = useId()
  // A reveal or a tie-break round starts the column at its top, so the heading and rank 1 show
  // beside the stage that names it, wherever the column was scrolled to for a dot.
  useEffect(() => {
    const column = heading.current?.closest('section')
    if (column) column.scrollTop = 0
  }, [moment, heading])
  const move = (index: number, delta: number) => {
    const ids = open.map((t) => t.id)
    const [id] = ids.splice(index, 1)
    if (!id) return
    ids.splice(index + delta, 0, id)
    void act('reorder_topics', { p_board: state.board_id, p_ids: ids })
  }
  return (
    <SideColumn label="To discuss" className={FILL_LEFT}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        To discuss <span className="text-muted">{open.length}</span>
      </h2>
      {open.length === 0 && (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          No topics to vote on. Anyone can add one in Discuss.
        </p>
      )}
      <ol ref={list} aria-labelledby={headingId} className="mt-2 flex flex-col gap-2">
        {open.map((t, i) => (
          <VoteCard
            key={t.id}
            ctx={ctx}
            topic={t}
            rank={i + 1}
            counts={counts}
            tied={tied.has(t.id)}
            takesDots={voting.has(t.id)}
            dots={dots}
            actions={own(t)}
            upNext={revealed && i === 0}
            onMove={revealed ? (delta) => move(i, delta) : undefined}
            last={i === open.length - 1}
          />
        ))}
      </ol>
      {skipped.length > 0 && (
        <>
          <h3
            id={skippedId}
            className="mt-4 flex justify-between px-1 text-[15px] font-bold text-muted"
          >
            Skipped <span>{skipped.length}</span>
          </h3>
          <ul aria-labelledby={skippedId} className="mt-2 flex flex-col gap-2">
            {skipped.map((t) => (
              <li key={t.id} className="rounded-xl border-2 border-dashed border-line bg-panel p-3">
                <p dir="auto" className="text-[15px] leading-snug wrap-anywhere">
                  {t.text}
                </p>
                <p className="mt-1 text-[13px] wrap-anywhere text-muted">
                  <bdi>{t.author_name}</bdi> · {plural(earlier.get(t.id) ?? 0, 'vote')}
                </p>
                <ActionList ctx={ctx} topic={t} actions={own(t)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </SideColumn>
  )
}

/**
 * A card in To discuss. Your dots are marked by filled dots and a pine edge, your own topic by a
 * dashed edge and words, a tie by the TIED badge: never by color alone.
 */
function VoteCard({
  ctx,
  topic: t,
  rank,
  counts,
  tied,
  takesDots,
  dots,
  actions,
  upNext,
  onMove,
  last,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  rank: number
  counts: VoteCounts | null
  tied: boolean
  takesDots: boolean
  dots: Dotting
  actions: Action[]
  upNext: boolean
  onMove?: (delta: number) => void
  last: boolean
}) {
  const { state, userId, isFacilitator } = ctx
  const mine = takesDots ? dots.on(t.id) : 0
  const own = takesDots && t.author_user_id === userId && !state.settings.own_vote
  const tie = counts?.tie.get(t.id) ?? 0
  const edge = own
    ? 'border-dashed border-line'
    : mine > 0
      ? 'border-teal'
      : upNext
        ? 'border-line-strong'
        : 'border-line-soft'
  // Arrows are not disabled at the ends: a button keeps focus when its card gets there.
  const arrow = (delta: number, blocked: boolean, glyph: string, where: string) => (
    <button
      type="button"
      className="size-11 rounded-lg border-2 border-line font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
      aria-disabled={blocked || undefined}
      aria-label={`Move "${t.text}" ${where}`}
      onClick={blocked ? undefined : () => onMove?.(delta)}
    >
      {glyph}
    </button>
  )
  return (
    <li className={`rounded-xl border-2 bg-panel p-3 ${edge}`}>
      {upNext && <p className={CARD_TAG}>UP NEXT</p>}
      <div className="flex items-start gap-2">
        {counts && (
          // The list is numbered for screen readers already.
          <span
            aria-hidden="true"
            className="w-5 shrink-0 text-[15px] leading-snug font-extrabold text-muted"
          >
            {rank}
          </span>
        )}
        <p dir="auto" className="min-w-0 flex-1 text-[15px] leading-snug font-bold wrap-anywhere">
          {t.text}
        </p>
      </div>
      <p
        className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted ${counts ? 'pl-7' : ''}`}
      >
        <span className="min-w-0 wrap-anywhere">
          <bdi>{t.author_name}</bdi>
          {counts && (
            <>
              {' · '}
              <b className="text-ink">{plural(counts.main.get(t.id) ?? 0, 'vote')}</b>
              {tie > 0 && ` + ${tie} in the tie-break`}
            </>
          )}
        </span>
        {tied && <span className={TIED}>TIED</span>}
      </p>
      {takesDots &&
        (own ? (
          <p className="mt-2 text-[13px] text-muted">
            <span className={`mr-2 ${TIED}`}>YOUR TOPIC</span>
            Voting on your own topic is off.
          </p>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* Not disabled at the limits either, so focus stays on the button. */}
            <button
              type="button"
              aria-label={`Remove a dot from "${t.text}"`}
              aria-disabled={mine === 0 || undefined}
              onClick={mine === 0 ? undefined : () => dots.cast(t, -1)}
              className="size-11 rounded-lg border-2 border-line text-xl font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              −
            </button>
            {mine > 0 ? (
              <Dots filled={mine} total={mine} label={`${mine} of your dots`} />
            ) : (
              <span className="text-[13px] text-muted">No dots yet</span>
            )}
            <button
              type="button"
              aria-label={`Add a dot to "${t.text}"`}
              aria-disabled={dots.left <= 0 || undefined}
              onClick={dots.left <= 0 ? undefined : () => dots.cast(t, 1)}
              className="size-11 rounded-lg bg-teal text-xl font-bold text-on-teal aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
              +
            </button>
          </div>
        ))}
      {onMove && isFacilitator && (
        <div className="mt-2 flex gap-2 pl-7">
          {arrow(-1, rank === 1, '↑', 'up')}
          {arrow(1, last, '↓', 'down')}
        </div>
      )}
      <ActionList ctx={ctx} topic={t} actions={actions} />
    </li>
  )
}
