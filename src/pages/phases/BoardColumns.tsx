import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { cards, extendedText, formatDuration, plural } from '../../lib/session'
import type { Action, Topic } from '../../lib/types'
import { Check, type PhaseProps } from './common'
import { BringBack, DeleteTopicDialog, TOPIC_MAX, TopicEditor } from './TopicTools'

// The side columns of the Discuss board. In dark mode --surface equals --panel, so the columns sit
// on the page ground with a 2 px ring instead, and the cards keep their edge.
const COLUMN =
  'flex min-w-0 flex-col rounded-2xl bg-surface p-3 dark:bg-ground dark:ring-2 dark:ring-line'

/**
 * Left column, To discuss: the queue with Up next first, the parking lot, then Skipped. The
 * facilitator reorders, edits, deletes and brings skipped topics back from here.
 */
export function QueueColumn({
  ctx,
  totals,
  onNote,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
  onNote: (message: string) => void
}) {
  const { board, state, act } = ctx
  const all = cards(board.data.topics)
  const queue = all.filter((t) => t.status === 'open')
  const skipped = all.filter((t) => t.status === 'skipped')
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const headingId = useId()
  const skippedId = useId()
  // The deleted card's button is gone, so focus moves to the heading. This runs after the dialog
  // has closed (child effects first), which would otherwise hand focus back to that button.
  const focusHeading = useRef(false)
  useEffect(() => {
    if (deleting === null && focusHeading.current) {
      focusHeading.current = false
      heading.current?.focus()
    }
  }, [deleting])

  const moveUp = (i: number) => {
    const ids = queue.map((q) => q.id)
    const [prev, cur] = [ids[i - 1], ids[i]]
    if (prev && cur) ids.splice(i - 1, 2, cur, prev)
    void act('reorder_topics', { p_board: state.board_id, p_ids: ids })
  }
  // The Bring back button disappears, so focus moves to the queue the topic returned to.
  const broughtBack = (message: string) => {
    onNote(message)
    list.current?.focus()
  }
  const shared = { ctx, onEdit: setEditing, onDelete: setDeleting }

  return (
    <section aria-label="To discuss" className={COLUMN}>
      <h2
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="flex justify-between px-1 text-[17px] font-bold"
      >
        To discuss <span className="text-muted">{queue.length}</span>
      </h2>
      <ol ref={list} tabIndex={-1} aria-labelledby={headingId} className="mt-2 flex flex-col gap-2">
        {queue.map((t, i) => (
          <TopicCard
            key={t.id}
            {...shared}
            topic={t}
            votes={totals.get(t.id) ?? 0}
            editing={editing === t.id}
            first={i === 0}
            onUp={() => moveUp(i)}
          />
        ))}
      </ol>
      {!state.topics_locked && <ParkingLot ctx={ctx} />}
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
          focusHeading.current = true
          onNote(message)
        }}
      />
    </section>
  )
}

interface CardProps {
  ctx: PhaseProps['ctx']
  topic: Topic
  votes: number
  editing: boolean
  onEdit: (id: string | null) => void
  onDelete: (t: Topic) => void
  first?: boolean
  onUp?: () => void
  onBack?: (message: string) => void
}

/** A card in To discuss: Up next is marked in words and a darker edge, skipped by a dashed one. */
function TopicCard({
  ctx,
  topic: t,
  votes,
  editing,
  onEdit,
  onDelete,
  first = false,
  onUp,
  onBack,
}: CardProps) {
  const editId = useId()
  // Save, Cancel and Escape put focus back on the Edit button; opening another editor does not.
  const refocus = useRef(false)
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      document.getElementById(editId)?.focus()
    }
  }, [editing, editId])
  const skipped = t.status === 'skipped'
  const tools = (
    <>
      <Button
        id={editId}
        variant="ghost"
        className="px-3"
        aria-label={`Edit "${t.text}"`}
        onClick={() => onEdit(t.id)}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        className="px-3"
        aria-label={`Delete "${t.text}"`}
        onClick={() => onDelete(t)}
      >
        Delete
      </Button>
    </>
  )
  return (
    <li
      className={`rounded-xl border-2 bg-panel p-3 ${skipped ? 'border-dashed border-line' : first ? 'border-line-strong' : 'border-line-soft'}`}
    >
      {editing ? (
        <TopicEditor
          ctx={ctx}
          topic={t}
          onDone={() => {
            refocus.current = true
            onEdit(null)
          }}
        />
      ) : (
        <>
          {first && (
            <p className="text-[13px] font-extrabold tracking-[0.1em] text-teal">UP NEXT</p>
          )}
          <p className={`text-[15px] leading-snug break-words ${skipped ? '' : 'font-bold'}`}>
            {t.text}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {t.author_name} · {plural(votes, 'vote')}
          </p>
          {ctx.isFacilitator &&
            (skipped ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {onBack && <BringBack ctx={ctx} topic={t} onBack={onBack} className="col-span-2" />}
                {tools}
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="size-11 shrink-0 rounded-lg border-2 border-line font-bold disabled:opacity-30"
                  disabled={first}
                  aria-label={`Move "${t.text}" up`}
                  onClick={onUp}
                >
                  ↑
                </button>
                {tools}
              </div>
            ))}
        </>
      )}
    </li>
  )
}

/** Parking lot: anyone adds a topic to the end of the queue, until the facilitator closes it. */
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
        <Button type="submit" variant="secondary" className="px-4">
          Add
        </Button>
      </div>
      <p id={countId} className="mt-1 px-1 text-[13px] text-muted">
        {text.length} of {TOPIC_MAX} characters
      </p>
    </form>
  )
}

/** Right column, Discussed: finished topics in order with time and votes, actions underneath. */
export function DiscussedColumn({
  ctx,
  totals,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
}) {
  const { topics, actions } = ctx.board.data
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const spent = discussed.reduce((ms, t) => ms + t.time_spent_ms, 0)
  return (
    <section aria-label="Discussed" className={COLUMN}>
      <h2 className="flex justify-between px-1 text-[17px] font-bold">
        Discussed <span className="text-muted">{discussed.length}</span>
      </h2>
      {discussed.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          Topics move here once discussed, with their time and the actions that came out of them.
        </p>
      ) : (
        <>
          <ol className="mt-2 flex flex-col gap-2">
            {discussed.map((t) => {
              const own = actions.filter((a) => a.topic_id === t.id)
              return (
                <li key={t.id} className="rounded-xl border-2 border-line-soft bg-panel p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      <Check />
                    </span>
                    <p className="min-w-0 flex-1 text-[15px] leading-snug font-bold break-words">
                      {t.text}
                    </p>
                  </div>
                  <p className="mt-1 pl-[26px] text-[13px] text-muted">
                    <b className="text-ink">{formatDuration(t.time_spent_ms)}</b> ·{' '}
                    {plural(totals.get(t.id) ?? 0, 'vote')}
                    {t.extensions > 0 && ` · ${extendedText(t.extensions)}`}
                  </p>
                  {own.length > 0 && (
                    <ul
                      aria-label={`Actions from "${t.text}"`}
                      className="mt-2 flex flex-col border-t-2 border-line-soft pt-1"
                    >
                      {own.map((a) => (
                        <li key={a.id}>
                          <ActionItem ctx={ctx} action={a} compact />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="mt-3 px-1 text-[14px] text-muted">
            <b className="text-ink">{formatDuration(spent)}</b> discussed so far ·{' '}
            <b className="text-ink">{plural(actions.length, 'action')}</b> in all
          </p>
        </>
      )}
    </section>
  )
}

/** An action and its done box, for everyone. The whole row is the 44 px target. */
export function ActionItem({
  ctx,
  action: a,
  compact = false,
}: {
  ctx: PhaseProps['ctx']
  action: Action
  compact?: boolean
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-3 ${compact ? 'text-[14px]' : 'rounded-xl bg-surface p-3 text-[16px] dark:bg-ground'}`}
    >
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-[var(--teal)]"
        checked={a.done}
        aria-label={`Done: ${a.text}`}
        onChange={(e) => ctx.act('toggle_action', { p_action: a.id, p_done: e.target.checked })}
      />
      <span className="min-w-0 flex-1 break-words">
        <span className={a.done ? 'line-through' : ''}>{a.text}</span>
        {compact && a.owner_name && <b className="whitespace-nowrap"> · {a.owner_name}</b>}
      </span>
      {!compact && a.owner_name && <b className="text-[14px]">{a.owner_name}</b>}
    </label>
  )
}
