import { useId } from 'react'
import { cards, extendedText, formatDuration, plural } from '../../lib/session'
import { Check, type PhaseProps } from './common'
import { CardActions, EndedAction, SideColumn } from './VoteBoard'

/**
 * Right column of the ended board: Discussed as in Discuss and Wrap-up (BoardColumns), read-only
 * (spec F25, decision D61). No edit or delete, and the done boxes are disabled. A disabled
 * fieldset around the live column would do the same, but axe then counts the column's scroll tab
 * stop as unreachable.
 */
export function EndedDiscussedColumn({
  ctx,
  totals,
  className,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
  className: string
}) {
  const { topics, actions } = ctx.board.data
  const discussed = topics
    .filter((t) => t.status === 'discussed')
    .sort((a, b) => (a.discussed_seq ?? 0) - (b.discussed_seq ?? 0))
  const onBoard = new Set(cards(topics).map((t) => t.id))
  const others = actions.filter((a) => a.topic_id === null || !onBoard.has(a.topic_id))
  const othersId = useId()
  const spent = discussed.reduce((ms, t) => ms + t.time_spent_ms, 0)
  return (
    <SideColumn label="Discussed" className={className}>
      <h2 className="flex justify-between px-1 text-[17px] font-bold">
        Discussed <span className="text-muted">{discussed.length}</span>
      </h2>
      {discussed.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          No topics were discussed.
        </p>
      ) : (
        // Two across when the column runs under the stage, between 1024 and 1280 px.
        <ol className="mt-2 grid gap-2 lg:max-xl:grid-cols-2">
          {discussed.map((t) => (
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
              <CardActions
                ctx={ctx}
                topic={t}
                actions={actions.filter((a) => a.topic_id === t.id)}
                readOnly
              />
            </li>
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
                <EndedAction action={a} />
              </li>
            ))}
          </ul>
        </>
      )}
      {discussed.length > 0 && (
        <p className="mt-3 px-1 text-[14px] text-muted">
          <b className="text-ink">{formatDuration(spent)}</b> discussed ·{' '}
          <b className="text-ink">{plural(actions.length, 'action')}</b> in all
        </p>
      )}
    </SideColumn>
  )
}
