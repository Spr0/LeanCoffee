import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import { callWhenDue } from '../../lib/retry'
import { cards, plural } from '../../lib/session'
import { formatClock } from '../../lib/time'
import type { Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { useNow } from '../../state/useNow'
import { DiscussedColumn, useEditFocus } from './BoardColumns'
import {
  ACCENT_CHIP,
  BoardFrame,
  CARD_TAG,
  FILL_LEFT,
  FILL_RIGHT,
  type PhaseProps,
  SessionTime,
  SideColumn,
  STAGE_TITLE,
  TimerButtons,
  useLiveNote,
} from './common'
import { TOPIC_MAX, TopicEditor } from './TopicTools'

const PER_PERSON = 5
// The stage's page heading when it says what to do, the same size in every phase.
// Nothing is discussed yet; Discussed keeps the board's shape from the first phase on.
const NO_VOTES = new Map<string, number>()

/**
 * Brainstorm as the board: To discuss fills up as people write, the writing form and the clock
 * are on the stage. Cards from others show only if the database returns them (hide topics off);
 * otherwise they are face down, drawn from the topic count alone.
 */
export default function Brainstorm({ ctx, remaining }: PhaseProps) {
  const { board, state, userId, isFacilitator, act } = ctx
  const [note, announce] = useLiveNote()
  const now = useNow(10_000)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const fieldId = useId()
  const countId = useId()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const hide = state.settings.hide_topics
  const shown = cards(board.data.topics)
  const mine = shown.filter((t) => t.author_user_id === userId)
  const others = shown.filter((t) => t.author_user_id !== userId)
  const hidden = hide ? Math.max(0, state.topic_count - shown.length) : 0
  const full = mine.length >= PER_PERSON
  if (editing !== null && !mine.some((t) => t.id === editing)) setEditing(null)
  // Brainstorm opens with the clock stopped at the full time until the facilitator starts it (D64).
  const notStarted =
    state.phase_ends_at === null && state.paused_remaining_ms === state.settings.brainstorm_s * 1000
  // Participants hear once that the clock started, if they saw it stopped.
  const [wasStopped, setWasStopped] = useState(notStarted)
  if (wasStopped !== notStarted) {
    setWasStopped(notStarted)
    if (!notStarted && !isFacilitator) announce('The clock has started.')
  }
  // The Start button is replaced by the timer controls; focus follows to Pause.
  const [starting, setStarting] = useState(false)
  const controls = useRef<HTMLDivElement>(null)
  const startedHere = useRef(false)
  useEffect(() => {
    if (!notStarted && startedHere.current) {
      startedHere.current = false
      controls.current?.querySelector('button')?.focus()
    }
  }, [notStarted])

  useAtZero(remaining, state.phase_ends_at, () => {
    chime()
    // Any browser closes the phase when the clock ends; the server checks the deadline.
    callWhenDue('close_brainstorm', { p_board: state.board_id })
  })

  // How many of your cards the last add counted. A second topic sent before the first has come
  // back in the list builds on it, so the count said out loud matches the counter.
  const counted = useRef(0)
  async function add(e?: FormEvent) {
    e?.preventDefault()
    if (!text.trim() || full) return
    // Clear at once so a slow reply cannot wipe the next topic being typed.
    const draft = text
    const used = Math.min(PER_PERSON, Math.max(mine.length, counted.current) + 1)
    counted.current = used
    setText('')
    if (await act('add_topic', { p_board: state.board_id, p_text: draft }))
      announce(`Added "${draft.trim()}". ${used} of ${PER_PERSON} used.`)
    else {
      counted.current = used - 1
      setText(draft)
    }
  }

  // The card's buttons go with it, so focus moves to the column heading.
  async function remove(t: Topic) {
    if (await act('delete_topic', { p_topic: t.id })) {
      counted.current = Math.max(0, mine.length - 1)
      announce(`"${t.text}" was deleted.`)
      heading.current?.focus()
    }
  }

  const end = () => act('start_phase', { p_board: state.board_id, p_phase: 'clarify' })
  // As in Discuss (D76): a 200 px ring keeps 72 px digits and leaves room for the form on a
  // 720 px share; while the clock shows 10:00 or more it needs 240 px for its five characters,
  // and the form gives up a row of its box so Add topic stays on the share.
  const totalMs = Math.max(remaining ?? 0, state.settings.brainstorm_s * 1000)
  const big = formatClock(remaining ?? totalMs).length > 4
  const column = (
    <>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        To discuss <span className="text-muted">{shown.length + hidden}</span>
      </h2>
      {shown.length + hidden === 0 && (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          Cards land here as people write them.
        </p>
      )}
      {shown.length > 0 && (
        <ul aria-labelledby={headingId} className="mt-2 flex flex-col gap-2">
          {mine.map((t) => (
            <YourCard
              key={t.id}
              ctx={ctx}
              topic={t}
              editing={editing === t.id}
              onEdit={setEditing}
              onDelete={remove}
            />
          ))}
          {others.map((t) => (
            <li key={t.id} className="rounded-xl border-2 border-line-soft bg-panel p-3">
              <p dir="auto" className="text-[15px] leading-snug font-bold wrap-anywhere">
                {t.text}
              </p>
              <p dir="auto" className="mt-1 text-[13px] wrap-anywhere text-muted">
                {t.author_name}
              </p>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <>
          {/* The backs of the cards; the line under them says the same in words. */}
          <div aria-hidden="true" className="mt-2 flex flex-col gap-2">
            {Array.from({ length: hidden }, (_, i) => (
              <div
                key={i}
                className="flex h-12 items-center rounded-xl border-2 border-line-soft bg-line-soft px-3 text-[13px] font-bold text-muted dark:bg-line"
              >
                Face down until Clarify
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[14px] text-muted">
            <b className="text-ink">{hidden} from others</b>, hidden until Clarify
          </p>
        </>
      )}
      {mine.length > 0 && (
        <p className="mt-3 px-1 text-[13px] text-muted">
          You can edit or delete your cards until the clarify step begins.
        </p>
      )}
    </>
  )

  const stage = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 grow basis-64">
          <span className={ACCENT_CHIP}>WRITING SILENTLY</span>
          {/* Focusable, so focus can land here when the Lobby's Start brainstorm goes. */}
          <h1 tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
            Write the topics you want to talk about
          </h1>
          <p className="mt-2 text-[16px] text-muted">
            {hide
              ? `One topic per card, up to ${PER_PERSON} each. Everyone else's cards stay face down until Clarify.`
              : `One topic per card, up to ${PER_PERSON} each. Everyone sees the cards as they are written.`}
            {/* Said here rather than under the buttons, so Add topic stays on a 720 px share. */}
            {isFacilitator && notStarted && ' People can add topics before you start the clock.'}
          </p>
          {!isFacilitator && notStarted && (
            <p className="mt-4 rounded-xl bg-teal-soft p-4 text-[15px] font-bold">
              The clock starts when the facilitator is ready.
            </p>
          )}
        </div>
        {/* Centered when it wraps under the heading, as on a phone. */}
        <div className="mx-auto">
          <RingTimer
            remaining={remaining}
            totalMs={totalMs}
            paused={state.paused_remaining_ms !== null && !notStarted}
            size={big ? 240 : 200}
          />
        </div>
      </div>
      {/* With the clock, so they stay on a 720 px share above the form. */}
      {isFacilitator && (
        <div
          ref={controls}
          className={`${big ? 'mt-3' : 'mt-4'} flex flex-wrap items-center gap-2`}
        >
          {notStarted ? (
            <>
              <Button
                className={`${big ? 'h-12' : 'h-14'} px-8 text-[17px]`}
                disabled={starting}
                onClick={async () => {
                  // Set first: the live update can arrive before the call returns.
                  startedHere.current = true
                  setStarting(true)
                  if (!(await act('timer_resume', { p_board: state.board_id })))
                    startedHere.current = false
                  setStarting(false)
                }}
              >
                Start the {formatClock(state.settings.brainstorm_s * 1000)} clock
              </Button>
              <Button variant="secondary" className={big ? 'h-12' : 'h-14'} onClick={end}>
                End brainstorm now
              </Button>
            </>
          ) : (
            <>
              <TimerButtons ctx={ctx} />
              <Button onClick={end}>End brainstorm now</Button>
            </>
          )}
        </div>
      )}
      <form
        onSubmit={add}
        className={`${big ? 'mt-3' : 'mt-4'} rounded-2xl border border-line-soft bg-surface p-4 dark:bg-ground`}
      >
        <label htmlFor={fieldId} className="text-[15px] font-bold">
          New topic
        </label>
        <textarea
          id={fieldId}
          dir="auto"
          aria-describedby={countId}
          value={text}
          maxLength={TOPIC_MAX}
          rows={big ? 1 : 2}
          disabled={full}
          onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
          placeholder={
            full
              ? `You have added ${PER_PERSON} topics, the most allowed.`
              : 'What do you want the group to talk about?'
          }
          className="mt-2 w-full resize-none rounded-xl border-2 border-teal bg-panel p-3 text-[17px] disabled:border-line"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p id={countId} className="text-[13px] text-muted">
            {text.length} of {TOPIC_MAX} characters · {mine.length} of {PER_PERSON} used · Press
            Enter to add
          </p>
          <Button type="submit" disabled={full || !text.trim()}>
            Add topic
          </Button>
        </div>
      </form>
    </>
  )

  return (
    <BoardFrame
      progress={
        <>
          <p className="text-[15px] font-bold">{plural(state.topic_count, 'topic')} so far</p>
          <SessionTime state={state} nowMs={now + board.offsetMs} />
        </>
      }
      tools={<PeopleButton ctx={ctx} />}
      left={
        <SideColumn label="To discuss" className={FILL_LEFT}>
          {column}
        </SideColumn>
      }
      stageLabel="Brainstorm"
      stage={stage}
      right={
        <DiscussedColumn ctx={ctx} totals={NO_VOTES} onNote={announce} className={FILL_RIGHT} />
      }
      note={note}
    />
  )
}

/** One of your cards: face up, marked in words, with Edit and Delete until Clarify. */
function YourCard({
  ctx,
  topic: t,
  editing,
  onEdit,
  onDelete,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  editing: boolean
  onEdit: (id: string | null) => void
  onDelete: (t: Topic) => void
}) {
  const { editId, closing } = useEditFocus(editing)
  return (
    <li className="rounded-xl border-2 border-teal bg-panel p-3">
      {editing ? (
        <TopicEditor
          ctx={ctx}
          topic={t}
          onDone={() => {
            closing()
            onEdit(null)
          }}
        />
      ) : (
        <>
          <p className={CARD_TAG}>YOURS</p>
          <p dir="auto" className="text-[15px] leading-snug font-bold wrap-anywhere">
            {t.text}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              id={editId}
              variant="ghost"
              className="min-w-0 px-3"
              aria-label={`Edit "${t.text}"`}
              onClick={() => onEdit(t.id)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              className="min-w-0 px-3"
              aria-label={`Delete "${t.text}"`}
              onClick={() => onDelete(t)}
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </li>
  )
}
