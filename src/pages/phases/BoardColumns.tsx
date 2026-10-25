import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import { cards, extendedText, formatDuration, plural } from '../../lib/session'
import type { Action, Topic } from '../../lib/types'
import { Check, type PhaseProps } from './common'
import { BringBack, DeleteTopicDialog, TOPIC_MAX, TopicEditor } from './TopicTools'

// The side columns of the Discuss board. In dark mode --surface equals --panel, so the columns sit
// on the page ground with a 2 px ring instead, and the cards keep their edge.
const COLUMN = 'min-w-0 rounded-2xl bg-surface p-3 dark:bg-ground dark:ring-2 dark:ring-line'

/**
 * A side column. `className` lets it fill its grid cell and scroll on its own beside the stage, so
 * reaching the parking lot or an old topic leaves the topic and the timer on the share. While it
 * scrolls it takes a tab stop, so keyboard users can scroll it too.
 */
function Column({
  label,
  className,
  children,
}: {
  label: string
  className: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setScrolls(el.scrollHeight > el.clientHeight + 1))
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return (
    <section
      ref={ref}
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region needs a tab stop
      tabIndex={scrolls ? 0 : undefined}
      className={`${COLUMN} ${className}`}
    >
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

/**
 * The open editor and the delete dialog for a column's cards. An editor left open on a card that
 * leaves the column closes, so it cannot reopen later and take focus. After a delete the card's
 * button is gone, so focus moves to the column heading; this runs after the dialog has closed
 * (child effects first), which would otherwise hand focus back to that button.
 */
function useCardTools(here: Topic[]) {
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  if (editing !== null && !here.some((t) => t.id === editing)) setEditing(null)
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
function useEditFocus(editing: boolean) {
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
  const { editing, setEditing, deleting, setDeleting, heading, afterDelete } = useCardTools([
    ...queue,
    ...skipped,
  ])
  const list = useRef<HTMLOListElement>(null)
  const headingId = useId()
  const skippedId = useId()

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
  const own = (t: Topic) => board.data.actions.filter((a) => a.topic_id === t.id)

  return (
    <Column label="To discuss" className={className}>
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
            actions={own(t)}
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
    </Column>
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

/**
 * Right column, Discussed: finished topics in order with time and votes, actions underneath, and
 * any actions left without a topic by a delete. The facilitator can still fix or remove a topic
 * here before the Word and Excel files are made.
 */
export function DiscussedColumn({
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
  const { topics, actions } = ctx.board.data
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const { editing, setEditing, deleting, setDeleting, heading, afterDelete } =
    useCardTools(discussed)
  const onBoard = new Set(cards(topics).map((t) => t.id))
  const others = actions.filter((a) => a.topic_id === null || !onBoard.has(a.topic_id))
  const othersId = useId()
  const spent = discussed.reduce((ms, t) => ms + t.time_spent_ms, 0)
  return (
    <Column label="Discussed" className={className}>
      <h2 ref={heading} tabIndex={-1} className="flex justify-between px-1 text-[17px] font-bold">
        Discussed <span className="text-muted">{discussed.length}</span>
      </h2>
      {discussed.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          Topics move here once discussed, with their time and the actions that came out of them.
        </p>
      ) : (
        // Two across when the column runs under the stage, between 1024 and 1280 px.
        <ol className="mt-2 grid gap-2 lg:max-xl:grid-cols-2">
          {discussed.map((t) => (
            <DiscussedCard
              key={t.id}
              ctx={ctx}
              topic={t}
              votes={totals.get(t.id) ?? 0}
              actions={actions.filter((a) => a.topic_id === t.id)}
              editing={editing === t.id}
              onEdit={setEditing}
              onDelete={setDeleting}
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
                <ActionItem ctx={ctx} action={a} compact />
              </li>
            ))}
          </ul>
        </>
      )}
      {discussed.length > 0 && (
        <p className="mt-3 px-1 text-[14px] text-muted">
          <b className="text-ink">{formatDuration(spent)}</b> discussed so far ·{' '}
          <b className="text-ink">{plural(actions.length, 'action')}</b> in all
        </p>
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
    </Column>
  )
}

/** A card in Discussed: a check and the time say it is done, not color alone. */
function DiscussedCard({ ctx, topic: t, votes, actions, editing, onEdit, onDelete }: CardProps) {
  const { editId, closing } = useEditFocus(editing)
  return (
    <li className="rounded-xl border-2 border-line-soft bg-panel p-3">
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
            <p className="min-w-0 flex-1 text-[15px] leading-snug font-bold break-words">
              {t.text}
            </p>
          </div>
          <p className="mt-1 pl-[26px] text-[13px] text-muted">
            <b className="text-ink">{formatDuration(t.time_spent_ms)}</b> · {plural(votes, 'vote')}
            {t.extensions > 0 && ` · ${extendedText(t.extensions)}`}
          </p>
          {ctx.isFacilitator && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <CardTools topic={t} editId={editId} onEdit={onEdit} onDelete={onDelete} />
            </div>
          )}
        </>
      )}
      <ActionList ctx={ctx} topic={t} actions={actions} />
    </li>
  )
}

/** A topic's actions under its card, each with its done box. */
function ActionList({
  ctx,
  topic,
  actions,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  actions: Action[]
}) {
  if (actions.length === 0) return null
  return (
    <ul
      aria-label={`Actions from "${topic.text}"`}
      className="mt-2 flex flex-col border-t-2 border-line-soft pt-1"
    >
      {actions.map((a) => (
        <li key={a.id}>
          <ActionItem ctx={ctx} action={a} compact />
        </li>
      ))}
    </ul>
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
