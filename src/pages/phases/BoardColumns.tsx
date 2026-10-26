import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { cards, extendedText, formatDuration, plural } from '../../lib/session'
import type { Action, Topic } from '../../lib/types'
import { CARD_TAG, Check, SideColumn, type PhaseProps } from './common'
import { BringBack, DeleteTopicDialog, TOPIC_MAX, TopicEditor } from './TopicTools'

// The side columns of the board. Each takes `className` to fill its grid cell and scroll on its
// own beside the stage, so reaching the parking lot or an old topic leaves the stage on the share.
// Scroll padding keeps a focused control's ring clear of the column's edge when it scrolls there.
const SCROLL_ROOM = 'scroll-py-3'
// Topic and action text: a long link or word breaks rather than widening every card.
const WRAP = '[overflow-wrap:anywhere]'

/**
 * The open editor and the delete dialog for a column's cards. An editor left open on a card that
 * leaves the column closes, so it cannot reopen later and take focus; so does one left open when
 * the facilitator role moves away (the delete dialog closes itself). After a delete the card's
 * button is gone, so focus moves to the column heading; this runs after the dialog has closed
 * (child effects first), which would otherwise hand focus back to that button.
 */
function useCardTools(here: Topic[], isFacilitator: boolean) {
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  if (editing !== null && (!isFacilitator || !here.some((t) => t.id === editing))) setEditing(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  useEffect(() => {
    if (deleting === null && focusHeading.current) {
      focusHeading.current = false
      heading.current?.focus()
    }
  }, [deleting])
  const afterDelete = () => {
    focusHeading.current = true
  }
  return { editing, setEditing, deleting, setDeleting, heading, afterDelete }
}

/** Save, Cancel and Escape put focus back on the card's Edit button; opening another editor does not. */
export function useEditFocus(editing: boolean) {
  const editId = useId()
  const refocus = useRef(false)
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      document.getElementById(editId)?.focus()
    }
  }, [editing, editId])
  const closing = () => {
    refocus.current = true
  }
  return { editId, closing }
}

/**
 * Left column, To discuss: the queue with Up next first, the parking lot, then Skipped. The
 * facilitator reorders, edits, deletes and brings skipped topics back from here. Actions from a
 * deferred or skipped topic stay under its card.
 */
export function QueueColumn({
  ctx,
  totals,
  onNote,
  className = '',
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
  onNote: (message: string) => void
  className?: string
}) {
  const { board, state, act } = ctx
  const all = cards(board.data.topics)
  const queue = all.filter((t) => t.status === 'open')
  const skipped = all.filter((t) => t.status === 'skipped')
  const { editing, setEditing, deleting, setDeleting, heading, afterDelete } = useCardTools(
    [...queue, ...skipped],
    ctx.isFacilitator,
  )
  const list = useRef<HTMLOListElement>(null)
  const headingId = useId()
  const skippedId = useId()

  // The arrow keeps focus and its name, so the live line says where the topic went.
  const moveUp = async (i: number) => {
    const ids = queue.map((q) => q.id)
    const [prev, cur] = [ids[i - 1], ids[i]]
    if (!prev || !cur) return
    ids.splice(i - 1, 2, cur, prev)
    if (!(await act('reorder_topics', { p_board: state.board_id, p_ids: ids }))) return
    const text = `"${queue[i]?.text}"`
    onNote(i === 1 ? `${text} is now up next.` : `${text} moved up to ${i} of ${ids.length}.`)
  }
  // The Bring back button disappears, so focus moves to the queue the topic returned to.
  const broughtBack = (message: string) => {
    onNote(message)
    list.current?.focus()
  }
  const shared = { ctx, onEdit: setEditing, onDelete: setDeleting }
  const own = (t: Topic) => board.data.actions.filter((a) => a.topic_id === t.id)

  return (
    <SideColumn label="To discuss" className={`${SCROLL_ROOM} ${className}`}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        To discuss <span className="text-muted">{queue.length}</span>
      </h2>
      {queue.length === 0 && (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          No topics waiting.
        </p>
      )}
      <ol
        ref={list}
        tabIndex={-1}
        aria-labelledby={headingId}
        className={`flex flex-col gap-2 ${queue.length > 0 ? 'mt-2' : ''}`}
      >
        {queue.map((t, i) => (
          <TopicCard
            key={t.id}
            {...shared}
            topic={t}
            votes={totals.get(t.id) ?? 0}
            actions={own(t)}
            editing={editing === t.id}
            first={i === 0}
            onUp={() => void moveUp(i)}
          />
        ))}
      </ol>
      {!state.topics_locked && <ParkingLot ctx={ctx} count={queue.length} />}
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
              <TopicCard
                key={t.id}
                {...shared}
                topic={t}
                votes={totals.get(t.id) ?? 0}
                actions={own(t)}
                editing={editing === t.id}
                onBack={broughtBack}
              />
            ))}
          </ul>
        </>
      )}
      <DeleteTopicDialog
        ctx={ctx}
        topic={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(message) => {
          afterDelete()
          onNote(message)
        }}
      />
    </SideColumn>
  )
}

interface CardProps {
  ctx: PhaseProps['ctx']
  topic: Topic
  votes: number
  actions: Action[]
  editing: boolean
  onEdit: (id: string | null) => void
  onDelete: (t: Topic) => void
}

/** The facilitator's Edit and Delete on a card, named for the topic. */
function CardTools({
  topic: t,
  editId,
  onEdit,
  onDelete,
}: Pick<CardProps, 'topic' | 'onEdit' | 'onDelete'> & { editId: string }) {
  return (
    <>
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
    </>
  )
}

/** A card in To discuss: Up next is marked in words and a darker edge, skipped by a dashed one. */
function TopicCard({
  ctx,
  topic: t,
  votes,
  actions,
  editing,
  onEdit,
  onDelete,
  first = false,
  onUp,
  onBack,
}: CardProps & { first?: boolean; onUp?: () => void; onBack?: (message: string) => void }) {
  const { editId, closing } = useEditFocus(editing)
  const skipped = t.status === 'skipped'
  const tools = <CardTools topic={t} editId={editId} onEdit={onEdit} onDelete={onDelete} />
  return (
    <li
      className={`rounded-xl border-2 bg-panel p-3 ${skipped ? 'border-dashed border-line' : first ? 'border-line-strong' : 'border-line-soft'}`}
    >
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
          {first && <p className={CARD_TAG}>UP NEXT</p>}
          <p
            dir="auto"
            className={`text-[15px] leading-snug ${WRAP} ${skipped ? '' : 'font-bold'}`}
          >
            {t.text}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            <bdi>{t.author_name}</bdi> · {plural(votes, 'vote')}
          </p>
          {ctx.isFacilitator &&
            (skipped ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {onBack && <BringBack ctx={ctx} topic={t} onBack={onBack} className="col-span-2" />}
                {tools}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-[44px_1fr_1fr] gap-2">
                {/* Not disabled at the top: the button keeps focus when its card gets there. */}
                <button
                  type="button"
                  className="size-11 rounded-lg border-2 border-line font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
                  aria-disabled={first || undefined}
                  aria-label={`Move "${t.text}" up`}
                  onClick={first ? undefined : onUp}
                >
                  ↑
                </button>
                {tools}
              </div>
            ))}
        </>
      )}
      <ActionList ctx={ctx} topic={t} actions={actions} />
    </li>
  )
}

/**
 * Parking lot: anyone adds a topic to the end of the queue, until the facilitator closes it. A new
 * card lands above the field, so the column scrolls to keep the focused field in sight.
 */
function ParkingLot({ ctx, count }: { ctx: PhaseProps['ctx']; count: number }) {
  const { state, act } = ctx
  const [text, setText] = useState('')
  const countId = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (el && document.activeElement === el) el.scrollIntoView({ block: 'nearest' })
  }, [count])
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
          ref={input}
          aria-label="Add a topic to the end of the queue"
          aria-describedby={countId}
          value={text}
          dir="auto"
          maxLength={TOPIC_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a topic"
          className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line-strong bg-panel px-3 text-[15px]"
        />
        <Button type="submit" variant="secondary" className="px-4">
          Add
        </Button>
      </div>
      {/* Shown once something is typed; screen readers always have the limit. */}
      <p id={countId} className={text ? 'mt-1 px-1 text-[13px] text-muted' : 'sr-only'}>
        {text.length} of {TOPIC_MAX} characters
      </p>
    </form>
  )
}

/**
 * Right column, Discussed: finished topics in order with time and votes, actions underneath, and
 * any actions left without a topic by a delete. The facilitator can still fix or remove a topic
 * here before the Word and Excel files are made. Once the session has ended it is read-only (spec
 * F25, decision D61): no Edit or Delete, and the done boxes are disabled.
 */
export function DiscussedColumn({
  ctx,
  totals,
  onNote,
  className = '',
  readOnly = false,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
  onNote: (message: string) => void
  className?: string
  readOnly?: boolean
}) {
  const { topics, actions } = ctx.board.data
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const { editing, setEditing, deleting, setDeleting, heading, afterDelete } = useCardTools(
    discussed,
    ctx.isFacilitator,
  )
  const onBoard = new Set(cards(topics).map((t) => t.id))
  const others = actions.filter((a) => a.topic_id === null || !onBoard.has(a.topic_id))
  const headingId = useId()
  const othersId = useId()
  const spent = discussed.reduce((ms, t) => ms + t.time_spent_ms, 0)
  // From Wrap-up on no more topics will be discussed.
  const over = ctx.state.phase === 'wrapup' || ctx.state.phase === 'ended'
  return (
    <SideColumn label="Discussed" className={`${SCROLL_ROOM} ${className}`}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        Discussed <span className="text-muted">{discussed.length}</span>
      </h2>
      {discussed.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          {over
            ? 'No topics were discussed.'
            : 'Topics move here once discussed, with their time and the actions that came out of them.'}
        </p>
      ) : (
        // Two across when the column runs under the stage, between 1024 and 1280 px. The tracks are
        // minmax(0, 1fr), so one long link or name cannot widen every card past the column.
        <ol
          aria-labelledby={headingId}
          className="mt-2 grid grid-cols-1 gap-2 lg:max-xl:grid-cols-2"
        >
          {discussed.map((t) => (
            <DiscussedCard
              key={t.id}
              ctx={ctx}
              topic={t}
              votes={totals.get(t.id) ?? 0}
              actions={actions.filter((a) => a.topic_id === t.id)}
              editing={!readOnly && editing === t.id}
              onEdit={setEditing}
              onDelete={setDeleting}
              readOnly={readOnly}
            />
          ))}
        </ol>
      )}
      {others.length > 0 && (
        <>
          <h3
            id={othersId}
            className="mt-4 flex justify-between px-1 text-[15px] font-bold text-muted"
          >
            Other actions <span>{others.length}</span>
          </h3>
          <ul
            aria-labelledby={othersId}
            className="mt-2 flex flex-col rounded-xl border-2 border-line-soft bg-panel px-3 py-1"
          >
            {others.map((a) => (
              <li key={a.id}>
                <ActionItem ctx={ctx} action={a} compact readOnly={readOnly} />
              </li>
            ))}
          </ul>
        </>
      )}
      {discussed.length > 0 && (
        <p className="mt-3 px-1 text-[14px] text-muted">
          <b className="text-ink">{formatDuration(spent)}</b> discussed{over ? '' : ' so far'} ·{' '}
          <b className="text-ink">{plural(actions.length, 'action')}</b> in all
        </p>
      )}
      {!readOnly && (
        <DeleteTopicDialog
          ctx={ctx}
          topic={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(message) => {
            afterDelete()
            onNote(message)
          }}
        />
      )}
    </SideColumn>
  )
}

/** A card in Discussed: a check and the time say it is done, not color alone. */
function DiscussedCard({
  ctx,
  topic: t,
  votes,
  actions,
  editing,
  onEdit,
  onDelete,
  readOnly,
}: CardProps & { readOnly: boolean }) {
  const { editId, closing } = useEditFocus(editing)
  return (
    <li className="min-w-0 rounded-xl border-2 border-line-soft bg-panel p-3">
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
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <Check />
            </span>
            <p dir="auto" className={`min-w-0 flex-1 text-[15px] leading-snug font-bold ${WRAP}`}>
              {t.text}
            </p>
          </div>
          <p className="mt-1 pl-[26px] text-[13px] text-muted">
            <b className="text-ink">{formatDuration(t.time_spent_ms)}</b> · {plural(votes, 'vote')}
            {t.extensions > 0 && ` · ${extendedText(t.extensions)}`}
          </p>
          {ctx.isFacilitator && !readOnly && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <CardTools topic={t} editId={editId} onEdit={onEdit} onDelete={onDelete} />
            </div>
          )}
        </>
      )}
      <ActionList ctx={ctx} topic={t} actions={actions} readOnly={readOnly} />
    </li>
  )
}

/** A topic's actions under its card, each with its done box (disabled once the board ends). */
export function ActionList({
  ctx,
  topic,
  actions,
  readOnly = false,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  actions: Action[]
  readOnly?: boolean
}) {
  if (actions.length === 0) return null
  return (
    <ul
      aria-label={`Actions from "${topic.text}"`}
      className="mt-2 flex flex-col border-t-2 border-line-soft pt-1"
    >
      {actions.map((a) => (
        <li key={a.id}>
          <ActionItem ctx={ctx} action={a} compact readOnly={readOnly} />
        </li>
      ))}
    </ul>
  )
}

/**
 * An action and its done box, for everyone. The whole row is the 44 px target. The box ticks at
 * once and goes back if the server refuses. Read-only, on the ended board, it is disabled (D61).
 */
export function ActionItem({
  ctx,
  action: a,
  compact = false,
  readOnly = false,
}: {
  ctx: PhaseProps['ctx']
  action: Action
  compact?: boolean
  readOnly?: boolean
}) {
  const [done, setDone] = useState(a.done)
  const [saved, setSaved] = useState(a.done)
  if (saved !== a.done) {
    setSaved(a.done)
    setDone(a.done)
  }
  return (
    // The box sits on the first line of the action, so in a stack of wrapped actions it is clear
    // which box goes with which; a one-line action stays centered in its 44 px row.
    <label
      className={`flex min-h-11 items-start ${readOnly ? '' : 'cursor-pointer'} ${compact ? 'gap-2 py-2.5 text-[14px]' : 'gap-3 rounded-xl bg-surface p-3 text-[16px] dark:bg-ground'}`}
    >
      <input
        type="checkbox"
        className={`size-5 shrink-0 accent-[var(--teal)] ${compact ? 'mt-px' : 'mt-0.5'}`}
        checked={done}
        disabled={readOnly}
        aria-label={`Done: ${a.text}`}
        onChange={async (e) => {
          const next = e.target.checked
          setDone(next)
          if (!(await ctx.act('toggle_action', { p_action: a.id, p_done: next }))) setDone(a.done)
        }}
      />
      <span className={`min-w-0 flex-1 ${WRAP}`}>
        <span dir="auto" className={done ? 'line-through' : ''}>
          {a.text}
        </span>
        {/* The space before the dot does not wrap, so a line never starts with it. */}
        {compact && a.owner_name && (
          <>
            <span className="whitespace-nowrap"> ·</span>{' '}
            <b>
              <bdi>{a.owner_name}</bdi>
            </b>
          </>
        )}
      </span>
      {!compact && a.owner_name && (
        <b className={`max-w-[40%] text-right text-[14px] leading-6 ${WRAP}`}>
          <bdi>{a.owner_name}</bdi>
        </b>
      )}
    </label>
  )
}
