import { cards, formatDuration } from '../../lib/session'
import type { PhaseProps } from './common'

/** Kanban overview of the session: To discuss, Discussing, Discussed, Actions. */
export default function BoardTab({
  ctx,
  totals,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
}) {
  const { topics, actions } = ctx.board.data
  const all = cards(topics)
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
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((col) => (
        <section key={col.title} aria-label={col.title} className="rounded-2xl bg-surface p-3">
          <h2 className="flex justify-between px-1 text-[17px] font-bold">
            {col.title} <span className="text-muted">{col.items.length}</span>
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {col.items.map((t) => (
              <li
                key={t.id}
                className={`rounded-xl border-2 bg-panel p-3 ${t.status === 'discussing' ? 'border-teal' : 'border-line-soft'}`}
              >
                <p
                  className={`font-bold ${t.status === 'discussing' ? 'text-[20px]' : 'text-[15px]'}`}
                >
                  {t.text}
                </p>
                <p className="mt-1 flex justify-between text-[13px] text-muted">
                  <span>
                    {t.author_name} · {totals.get(t.id) ?? 0}{' '}
                    {totals.get(t.id) === 1 ? 'vote' : 'votes'}
                  </span>
                  {t.status === 'discussed' && (
                    <b className="text-ink">{formatDuration(t.time_spent_ms)}</b>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
    </div>
  )
}
