import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import { cards, mergedInto, plural } from '../../lib/session'
import { formatClock } from '../../lib/time'
import type { Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import { DiscussedColumn, useEditFocus } from './BoardColumns'
import { clarifyMoves } from './ClarifyMoves'
import {
  ACCENT_CHIP,
  BoardFrame,
  CARD_TAG,
  Eyebrow,
  FILL_LEFT,
  FILL_RIGHT,
  FOCUS_TITLE,
  type PhaseProps,
  SessionTime,
  SideColumn,
  STAGE_TITLE,
  TimerButtons,
  useLiveNote,
  useRefocus,
} from './common'
import { DeleteTopicDialog, TopicEditor } from './TopicTools'

/** Dots per person suggested in spec section 3 (Xebia): topics divided by two, 1 to 5. */
const suggestDots = (topics: number) => Math.min(5, Math.max(1, Math.round(topics / 2)))
// Nothing is discussed yet; Discussed keeps the board's shape from the first phase on.
const NO_VOTES = new Map<string, number>()
// The stage's page heading: 32 px when it says what to do, as in every phase, and 44 px for the
// Teams share when it is the topic in focus.

/**
 * Clarify as the board: every card face up in To discuss, merged cards stacked under the card
 * they joined. The stage holds the current focus: the card being pitched with its clock, the
 * merge of two selected cards, or how to tidy up; under it the suggested dots. The facilitator's
 * Continue to voting is in the toolbar, so a long topic on stage cannot push it off the share.
 */
export default function Clarify({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator, act } = ctx
  const [note, announce] = useLiveNote()
  const now = useNow(10_000)
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  // A card taken out of a stack: its Undo merge has gone, so focus moves to the card itself.
  const [restored, setRestored] = useState<string | null>(null)
  const columnHeading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const topics = board.data.topics
  const list = cards(topics)
  const pitching = list.find((t) => t.id === state.pitch_topic_id)
  const pitchIndex = pitching ? list.indexOf(pitching) : -1
  const next = list[pitchIndex + 1]
  // Cards pitched so far, so Start pitches carries on after Stop pitching or a merge instead of
  // going back to the first card.
  const [pitched, setPitched] = useState<string[]>([])
  if (state.pitch_topic_id && !pitched.includes(state.pitch_topic_id))
    setPitched([...pitched, state.pitch_topic_id])
  const resumeAt = list.some((t) => pitched.includes(t.id))
    ? list.find((t) => !pitched.includes(t.id))
    : undefined
  // Cards merged or deleted since they were selected drop out of the selection.
  const chosen = selected.filter((id) => list.some((t) => t.id === id))
  const [target, source] = chosen.map((id) => list.find((t) => t.id === id))
  const merging = isFacilitator && chosen.length === 2
  if (editing !== null && !list.some((t) => t.id === editing)) setEditing(null)

  // A soft clock: chime at zero, never cut anyone off.
  useAtZero(remaining, state.phase_ends_at, chime)

  // One polite line when cards merge, come apart or are deleted, or the next pitch starts. Edits
  // are in the key too (not said), so a card edited and then deleted is named as it was last.
  const moveKey = JSON.stringify([
    state.pitch_topic_id,
    ...topics.map((t) => [t.id, t.merged_into, t.text]),
  ])
  const [seen, setSeen] = useState({ key: moveKey, topics, pitch: state.pitch_topic_id })
  if (seen.key !== moveKey) {
    setSeen({ key: moveKey, topics, pitch: state.pitch_topic_id })
    const message = clarifyMoves(seen, { topics, pitch: state.pitch_topic_id })
    if (message) announce(message)
  }

  // Start pitches, Stop pitching, Merge and Keep separate leave with the stage's old content.
  const { area: stage, target: heading } = useRefocus<HTMLElement, HTMLHeadingElement>(
    `${pitching?.id}|${merging}`,
  )

  // After a delete the card's buttons are gone, so focus moves to the column heading. This runs
  // after the dialog has closed (child effects first), which would hand focus back to Delete.
  const focusColumn = useRef(false)
  useEffect(() => {
    if (deleting === null && focusColumn.current) {
      focusColumn.current = false
      columnHeading.current?.focus()
    }
  }, [deleting])

  // The first card selected keeps its place. The merge itself happens on the stage, which comes
  // after the column, so selecting the second card says where to go.
  const toggle = (id: string) => {
    const now = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(-2)
    setSelected(now)
    if (now.length === 2 && !chosen.includes(id))
      announce('Two cards selected. Merge them or keep them separate on the stage.')
  }
  async function merge() {
    if (!target || !source) return
    const endsPitch = source.id === state.pitch_topic_id
    if (await act('merge_topics', { p_source: source.id, p_target: target.id })) {
      setSelected([])
      // The server keeps a merged card on as the pitch, with its clock running; end it.
      if (endsPitch) void startPitch(null)
    }
  }
  async function unmerge(id: string) {
    if (await act('unmerge_topic', { p_topic: id })) setRestored(id)
  }
  const startPitch = (id: string | null) =>
    act('set_pitch', { p_board: state.board_id, p_topic: id })
  const toVote = () => act('start_phase', { p_board: state.board_id, p_phase: 'vote' })

  const mergedCount = topics.filter((t) => t.merged_into !== null).length
  const column = (
    <>
      <h2
        ref={columnHeading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        To discuss <span className="text-muted">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          Nobody added a topic.
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="mt-2 flex flex-col gap-2">
          {list.map((t) => (
            <ClarifyCard
              key={t.id}
              ctx={ctx}
              topic={t}
              merged={mergedInto(topics, t.id)}
              pitching={t.id === pitching?.id}
              selected={chosen.includes(t.id)}
              editing={editing === t.id}
              restored={restored === t.id}
              onToggle={() => toggle(t.id)}
              onEdit={setEditing}
              onDelete={setDeleting}
              onUndo={(id) => void unmerge(id)}
              onRestored={() => setRestored(null)}
            />
          ))}
        </ul>
      )}
      <DeleteTopicDialog
        ctx={ctx}
        topic={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          // Said on the live line once the topics reload, for everyone.
          focusColumn.current = true
          setSelected((ids) => ids.filter((id) => id !== deleting?.id))
        }}
      />
    </>
  )

  return (
    <BoardFrame
      progress={
        <>
          <p className="text-[15px] font-bold">
            {plural(list.length, 'topic')}
            {mergedCount > 0 && (
              <span className="font-medium text-muted">
                {' '}
                · {plural(mergedCount, 'card')} merged
              </span>
            )}
          </p>
          <SessionTime state={state} nowMs={now + board.offsetMs} />
        </>
      }
      tools={
        <>
          <PeopleButton ctx={ctx} />
          {/* The pitch clock's buttons, here so the stage's float stays as short as the ring. */}
          {isFacilitator && pitching && state.settings.pitch_s > 0 && (
            <TimerButtons ctx={ctx} addSeconds={15} />
          )}
          {isFacilitator && <Button onClick={toVote}>Continue to voting</Button>}
        </>
      }
      left={
        <SideColumn label="To discuss" className={FILL_LEFT}>
          {column}
        </SideColumn>
      }
      stageLabel="Clarify"
      stageRef={stage}
      stage={
        <>
          {merging && target && source ? (
            <MergeStage
              topics={topics}
              target={target}
              source={source}
              heading={heading}
              pitching={source.id === state.pitch_topic_id}
              onMerge={merge}
              onKeep={() => setSelected([])}
            />
          ) : pitching ? (
            <PitchStage
              ctx={ctx}
              topic={pitching}
              number={pitchIndex + 1}
              count={list.length}
              remaining={remaining}
              next={next}
              heading={heading}
              onPitch={startPitch}
            />
          ) : (
            <TidyStage
              ctx={ctx}
              count={list.length}
              first={target}
              heading={heading}
              resume={resumeAt && { number: list.indexOf(resumeAt) + 1, count: list.length }}
              onStart={() => void startPitch((resumeAt ?? list[0])?.id ?? null)}
              onSkip={toVote}
            />
          )}
          {isFacilitator && <NextStep ctx={ctx} count={list.length} />}
        </>
      }
      right={
        <DiscussedColumn ctx={ctx} totals={NO_VOTES} onNote={announce} className={FILL_RIGHT} />
      }
      note={note}
    />
  )
}

/**
 * A card in To discuss. For the facilitator the card itself is the select button. A card just
 * taken out of a stack (`restored`) takes focus once it is back in the list.
 */
function ClarifyCard({
  ctx,
  topic: t,
  merged,
  pitching,
  selected,
  editing,
  restored,
  onToggle,
  onEdit,
  onDelete,
  onUndo,
  onRestored,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  merged: Topic[]
  pitching: boolean
  selected: boolean
  editing: boolean
  restored: boolean
  onToggle: () => void
  onEdit: (id: string | null) => void
  onDelete: (t: Topic) => void
  onUndo: (id: string) => void
  onRestored: () => void
}) {
  const { isFacilitator } = ctx
  const { editId, closing } = useEditFocus(editing)
  const select = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!restored) return
    select.current?.focus()
    onRestored()
  }, [restored, onRestored])
  const tags = [pitching && 'PITCHING NOW', selected && 'SELECTED'].filter(Boolean)
  const body = (
    <span className="flex items-start gap-2">
      <span className="min-w-0 flex-1">
        {tags.length > 0 && <span className={`block ${CARD_TAG}`}>{tags.join(' · ')}</span>}
        <span dir="auto" className="block text-[15px] leading-snug font-bold wrap-anywhere">
          {t.text}
        </span>
        <span dir="auto" className="mt-1 block text-[13px] wrap-anywhere text-muted">
          {t.author_name}
        </span>
      </span>
      {/* A box to tick says the card can be selected; ticked, with SELECTED, when it is. */}
      {isFacilitator && (
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 ${selected ? 'border-teal bg-teal text-on-teal' : 'border-line-strong bg-panel'}`}
        >
          {selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M5 12l5 5L20 7" strokeWidth="4" />
            </svg>
          )}
        </span>
      )}
    </span>
  )
  return (
    <li
      className={`rounded-xl border-2 ${pitching ? 'border-teal bg-teal-soft' : selected ? 'border-teal bg-panel' : 'border-line-soft bg-panel'}`}
    >
      {isFacilitator && editing ? (
        <div className="p-3">
          <TopicEditor
            ctx={ctx}
            topic={t}
            onDone={() => {
              closing()
              onEdit(null)
            }}
          />
        </div>
      ) : isFacilitator ? (
        <>
          <button
            ref={select}
            type="button"
            className="w-full rounded-xl p-3 text-start"
            aria-pressed={selected}
            onClick={onToggle}
          >
            {body}
          </button>
          {/* Named for the topic, as on every other phase's cards. */}
          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            <Button
              id={editId}
              variant="ghost"
              className={`min-w-0 px-3 ${pitching ? 'col-span-2' : ''}`}
              aria-label={`Edit "${t.text}"`}
              onClick={() => onEdit(t.id)}
            >
              Edit
            </Button>
            {/* Deleting the card being pitched would leave its clock running. */}
            {!pitching && (
              <Button
                variant="ghost"
                className="min-w-0 px-3"
                aria-label={`Delete "${t.text}"`}
                onClick={() => onDelete(t)}
              >
                Delete
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="p-3">{body}</div>
      )}
      {merged.length > 0 && (
        // Stacked under the card they joined, like stickies moved together on the wall.
        <ul aria-label={`Merged into "${t.text}"`} className="flex flex-col gap-1.5 px-3 pb-3">
          {merged.map((c) => (
            <MergedCard
              key={c.id}
              topic={c}
              onUndo={isFacilitator ? () => onUndo(c.id) : undefined}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function MergedCard({ topic: c, onUndo }: { topic: Topic; onUndo?: () => void }) {
  const textId = useId()
  return (
    <li className="ml-2 flex min-h-11 items-center gap-2 rounded-lg border-2 border-line-soft bg-surface py-1 pr-1 pl-2.5 text-[14px] dark:bg-ground">
      <span id={textId} dir="auto" className="min-w-0 flex-1 wrap-anywhere">
        + {c.text}{' '}
        <span className="text-muted">
          (<bdi>{c.author_name}</bdi>)
        </span>
      </span>
      {onUndo && (
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-lg px-2 text-[15px] font-bold text-teal underline"
          aria-describedby={textId}
          onClick={onUndo}
        >
          Undo merge
        </button>
      )}
    </li>
  )
}

/**
 * The card being pitched, as the page heading at 44 px. The soft clock is a ring as in the other
 * phases; it floats beside the first lines and the topic runs full width under it, and on a
 * narrow stage it goes under the topic. The facilitator's Next pitch and Stop pitching sit in one
 * row under the ring and the clock's buttons are in the toolbar, so a 160-character topic and its
 * buttons stay on a 720 px share. A pitch is short, so the ring turns urgent at 0:10. Each pitch
 * gets its own ring, so a "Time's up" said for the last one is not left in its live text.
 */
function PitchStage({
  ctx,
  topic,
  number,
  count,
  remaining,
  next,
  heading,
  onPitch,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  number: number
  count: number
  remaining: number | null
  next: Topic | undefined
  heading: RefObject<HTMLHeadingElement | null>
  onPitch: (id: string | null) => void
}) {
  const { board, state, isFacilitator } = ctx
  const merged = mergedInto(board.data.topics, topic.id)
  const timed = state.settings.pitch_s > 0
  const totalMs = Math.max(remaining ?? 0, state.settings.pitch_s * 1000)
  return (
    <div className="flex flex-col gap-3 @lg:flow-root">
      {(timed || isFacilitator) && (
        <div
          className={`order-last mx-auto flex flex-col gap-2 @lg:float-right @lg:mb-2 @lg:ml-6 ${isFacilitator ? 'w-60' : ''}`}
        >
          {timed && (
            <div className="mx-auto mb-2">
              <RingTimer
                key={topic.id}
                remaining={remaining}
                totalMs={totalMs}
                paused={state.paused_remaining_ms !== null}
                size={formatClock(totalMs).length > 4 ? 240 : 200}
                urgentMs={10_000}
              />
            </div>
          )}
          {isFacilitator && (
            // One row under the ring keeps the float short, so a long topic stays on the share.
            <div className="flex gap-2 [&_button]:min-w-0 [&_button]:grow [&_button]:px-3 [&_button]:leading-tight">
              <Button disabled={!next} onClick={() => onPitch(next?.id ?? null)}>
                {next ? 'Next pitch' : 'Last pitch done'}
              </Button>
              <Button variant="secondary" onClick={() => onPitch(null)}>
                Stop pitching
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <span className={ACCENT_CHIP}>
          PITCH {number} OF {count}
        </span>
      </div>
      <div className="min-w-0 @lg:mt-3">
        <h1 ref={heading} tabIndex={-1} dir="auto" className={FOCUS_TITLE}>
          {topic.text}
        </h1>
        <p className="mt-2 text-[17px] wrap-anywhere text-muted">
          <b className="text-ink">
            <bdi>{topic.author_name}</bdi>
          </b>{' '}
          is pitching it in a sentence or two
        </p>
        {timed && (
          <p className="mt-1 text-[14px] text-muted">
            A soft clock: it chimes at zero and never cuts anyone off.
          </p>
        )}
        {merged.length > 0 && (
          <p className="mt-2 text-[16px] wrap-anywhere">
            <b>Merged in:</b>{' '}
            {merged.map((c, i) => (
              <span key={c.id}>
                {i > 0 && '; '}
                <bdi>{c.text}</bdi> (<bdi>{c.author_name}</bdi>)
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The facilitator's merge of the two selected cards. Cards already merged into either come too.
 * The buttons come before the two cards, so two 160-character topics leave them on the share.
 */
function MergeStage({
  topics,
  target,
  source,
  heading,
  pitching,
  onMerge,
  onKeep,
}: {
  topics: Topic[]
  target: Topic
  source: Topic
  heading: RefObject<HTMLHeadingElement | null>
  /** The card that joins is being pitched: merging ends its pitch. */
  pitching: boolean
  onMerge: () => void
  onKeep: () => void
}) {
  const carriedBySource = mergedInto(topics, source.id).length
  const side = (tag: string, t: Topic) => {
    const carried = mergedInto(topics, t.id).length
    return (
      <div className="min-w-0 rounded-xl border-2 border-line bg-surface p-4 dark:bg-ground">
        <p className={CARD_TAG}>{tag}</p>
        <p dir="auto" className="mt-1 text-[20px] leading-snug font-bold wrap-anywhere">
          {t.text}
        </p>
        <p className="mt-1 text-[14px] wrap-anywhere text-muted">
          <bdi>{t.author_name}</bdi>
          {carried > 0 && ` · ${plural(carried, 'card')} merged in`}
        </p>
      </div>
    )
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className={ACCENT_CHIP}>TIDYING UP</span>
      </div>
      <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
        Merge these two?
      </h1>
      <p className="mt-2 text-[16px] text-muted">
        Votes are not split between near-duplicates. You can undo until voting starts.
        {/* The server keeps no record of the earlier stack, so each card comes back on its own. */}
        {carriedBySource === 1 &&
          ' The card merged into the one that joins comes along, with its own Undo merge.'}
        {carriedBySource > 1 &&
          ` The ${carriedBySource} cards merged into the one that joins come along, each with its own Undo merge.`}
      </p>
      {pitching && (
        <p className="mt-2 text-[16px] font-bold">
          The card that joins is being pitched. Merging ends its pitch, and Resume pitches goes on
          to the next card.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-14 px-8 text-[17px]" onClick={onMerge}>
          Merge 2 selected
        </Button>
        <Button variant="ghost" className="h-14" onClick={onKeep}>
          Keep separate
        </Button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 @lg:grid-cols-2">
        {side('KEEPS ITS PLACE', target)}
        {side('JOINS IT', source)}
      </div>
    </>
  )
}

/** Before and between pitches: what Clarify is for, and for the facilitator how to tidy up. */
function TidyStage({
  ctx,
  count,
  first,
  heading,
  resume,
  onStart,
  onSkip,
}: {
  ctx: PhaseProps['ctx']
  count: number
  first: Topic | undefined
  heading: RefObject<HTMLHeadingElement | null>
  /** Where pitches carry on, once some cards have been pitched. */
  resume: { number: number; count: number } | undefined
  onStart: () => void
  onSkip: () => void
}) {
  const { isFacilitator } = ctx
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className={ACCENT_CHIP}>EVERY CARD FACE UP</span>
      </div>
      <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
        Here is everything the group wrote
      </h1>
      <p className="mt-2 text-[16px] text-muted">
        Each person pitches their topic in a sentence or two. Do not start the discussion yet.
      </p>
      {count === 0 ? (
        <p className="mt-4 rounded-xl bg-surface p-4 text-[17px] dark:bg-ground">
          Nobody added a topic. Continue to voting and on to Discuss, where anyone can add topics to
          the queue.
        </p>
      ) : isFacilitator ? (
        <>
          <p className="mt-4 text-[15px]">
            <b>To tidy up,</b> select two cards that say the same thing and merge them. The first
            one you select keeps its place. You can undo a merge until voting starts.
          </p>
          {first && (
            <p className="mt-2 text-[15px] font-bold wrap-anywhere">
              Selected "<bdi>{first.text}</bdi>". Select one more card to merge with it.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="h-14 px-8 text-[17px]" onClick={onStart}>
              {resume ? `Resume pitches (${resume.number} of ${resume.count})` : 'Start pitches'}
            </Button>
            {/* When the cards already speak for themselves, go straight to voting. */}
            <Button variant="secondary" className="h-14" onClick={onSkip}>
              Skip pitches
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-6 text-[17px] font-bold">
          The facilitator starts the pitches, or goes straight to voting.
        </p>
      )}
    </>
  )
}

/** Before voting, for the facilitator: the suggested dots, and what Continue to voting opens. */
function NextStep({ ctx, count }: { ctx: PhaseProps['ctx']; count: number }) {
  const { state, act } = ctx
  const dots = suggestDots(count)
  const using = state.settings.dots === dots
  return (
    <div className="mt-5 border-t-2 border-line-soft pt-4">
      {count > 0 && (
        <>
          <Eyebrow>Dots per person: {state.settings.dots} each</Eyebrow>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-[15px]">
              Suggested: {dots} {dots === 1 ? 'dot' : 'dots'} each (topics / 2, at most 5)
            </p>
            {/* Not disabled once applied: the button keeps keyboard focus. */}
            <Button
              variant="secondary"
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-disabled={using || undefined}
              onClick={
                using
                  ? undefined
                  : () => act('update_settings', { p_board: state.board_id, p_settings: { dots } })
              }
            >
              {using ? 'Using' : 'Use'} {dots} {dots === 1 ? 'dot' : 'dots'}
            </Button>
          </div>
        </>
      )}
      <p className="mt-2 text-[14px] text-muted">
        Continue to voting opens {plural(state.settings.dots, 'dot')} each and a{' '}
        {formatClock(state.settings.vote_s * 1000)} clock.
      </p>
    </div>
  )
}
