import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { cards, formatDuration } from '../../lib/session'
import type { Topic } from '../../lib/types'
import type { PhaseProps } from './common'
import Downloads from './Downloads'
import { BringBack, DeleteTopicDialog, TopicEditor } from './TopicTools'

/** Kanban overview of the session: To discuss, Discussing, Discussed, Actions, then Skipped. */
export default function BoardTab({
  ctx,
  totals,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
}) {
  const { topics, actions } = ctx.board.data
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  const [note, setNote] = useState('')
  const all = cards(topics)
  const skipped = all.filter((t) => t.status === 'skipped')
  const columns = [
    { title: 'To discuss', items: all.filter((t) => t.status === 'open') },
    { title: 'Discussing', items: all.filter((t) => t.status === 'discussing') },
    {
      title: 'Discussed',
      items: all
        .filter((t) => t.status === 'discussed')
        .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0)),
    },
  ]
  const column = (title: string, items: Topic[]) => (
    <section key={title} aria-label={title} className="rounded-2xl bg-surface p-3">
      <h2 className="flex justify-between px-1 text-[17px] font-bold">
        {title} <span className="text-muted">{items.length}</span>
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((t) => (
          <TopicCard
            key={t.id}
            ctx={ctx}
            topic={t}
            votes={totals.get(t.id) ?? 0}
            editing={editing === t.id}
            onEdit={setEditing}
            onDelete={setDeleting}
            onNote={setNote}
          />
        ))}
      </ul>
    </section>
  )
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <h1 className="sr-only">Board overview</h1>
      {columns.map((col) => column(col.title, col.items))}
      <section aria-label="Actions" className="rounded-2xl bg-surface p-3">
        <h2 className="flex justify-between px-1 text-[17px] font-bold">
          Actions <span className="text-muted">{actions.length}</span>
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {actions.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border-2 border-line-soft bg-panel p-3 text-[15px]"
            >
              <p className={a.done ? 'line-through' : ''}>{a.text}</p>
              {a.owner_name && <p className="mt-1 text-[13px] text-muted">Owner: {a.owner_name}</p>}
            </li>
          ))}
        </ul>
      </section>
      {skipped.length > 0 && column('Skipped', skipped)}
      <div className="rounded-2xl bg-surface p-4 md:col-span-2 xl:col-span-4">
        <Downloads data={ctx.board.data} wide />
      </div>
      <p role="status" className="sr-only">
        {note}
      </p>
      <DeleteTopicDialog
        ctx={ctx}
        topic={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={setNote}
      />
    </div>
  )
}

function TopicCard({
  ctx,
  topic: t,
  votes,
  editing,
  onEdit,
  onDelete,
  onNote,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  votes: number
  editing: boolean
  onEdit: (id: string | null) => void
  onDelete: (t: Topic) => void
  onNote: (message: string) => void
}) {
  const editId = useId()
  // Save, Cancel and Escape put focus back on the Edit button; opening another editor does not.
  const refocus = useRef(false)
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      document.getElementById(editId)?.focus()
    }
  }, [editing, editId])
  const discussing = t.status === 'discussing'
  return (
    <li
      className={`rounded-xl border-2 bg-panel p-3 ${discussing ? 'border-teal' : t.status === 'skipped' ? 'border-dashed border-line' : 'border-line-soft'}`}
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
          <p className={`font-bold break-words ${discussing ? 'text-[20px]' : 'text-[15px]'}`}>
            {t.text}
          </p>
          <p className="mt-1 flex justify-between text-[13px] text-muted">
            <span>
              {t.author_name} · {votes} {votes === 1 ? 'vote' : 'votes'}
            </span>
            {t.status === 'discussed' && (
              <b className="text-ink">{formatDuration(t.time_spent_ms)}</b>
            )}
          </p>
          {ctx.isFacilitator && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {t.status === 'skipped' && (
                <BringBack ctx={ctx} topic={t} onBack={onNote} className="col-span-2" />
              )}
              <Button
                id={editId}
                variant="ghost"
                className="px-3"
                aria-label={`Edit "${t.text}"`}
                onClick={() => onEdit(t.id)}
              >
                Edit
              </Button>
              {/* The topic on stage cannot be deleted; the server refuses it too. */}
              {!discussing && (
                <Button
                  variant="ghost"
                  className="px-3"
                  aria-label={`Delete "${t.text}"`}
                  onClick={() => onDelete(t)}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  )
}
