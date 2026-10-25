import { useState, type FormEvent } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { Avatar, Button } from '../../components/ui'
import { cards } from '../../lib/session'
import { useNow } from '../../state/useNow'
import { Eyebrow, Layout, PageTitle, type PhaseProps } from './common'

export default function WrapUp({ ctx, remaining }: PhaseProps) {
  const { board, state, userId, isFacilitator, act } = ctx
  const { topics, actions, takeaways, participants } = board.data
  const ended = state.phase === 'ended'
  const now = useNow(10_000)
  const [text, setText] = useState('')
  const [newAction, setNewAction] = useState('')
  const all = cards(topics)
  const discussed = all.filter((t) => t.status === 'discussed').length
  const left = all.filter((t) => t.status === 'open').length
  const endMs = state.ended_at ? Date.parse(state.ended_at) : now + board.offsetMs
  const minutes = state.started_at ? Math.round((endMs - Date.parse(state.started_at)) / 60_000) : 0
  const mine = takeaways.find((t) => t.user_id === userId)

  async function share(e: FormEvent) {
    e.preventDefault()
    if (text.trim() && (await act('set_takeaway', { p_board: state.board_id, p_text: text })))
      setText('')
  }

  const stats = [
    [`${discussed} of ${all.length}`, 'topics discussed'],
    [`${minutes} min`, `of ${state.planned_minutes} planned`],
    [String(actions.length), 'actions captured'],
    [`${left} left`, 'not discussed'],
  ]

  return (
    <Layout
      ctx={ctx}
      main={
        <div className="max-w-[820px]">
          <PageTitle
            title={
              ended ? 'This session has ended' : 'Nice work. Capture what you are taking away.'
            }
            intro={
              ended
                ? 'The board is read-only. Download the results before it is deleted.'
                : 'One line each. Passing is fine.'
            }
          />
          <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map(([value, label]) => (
              <div key={label} className="rounded-xl border border-line-soft p-4">
                <dt className="sr-only">{label}</dt>
                <dd className="text-[26px] font-extrabold">{value}</dd>
                <dd className="text-[14px] text-muted" aria-hidden="true">
                  {label}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-7">
            <Eyebrow
              right={`${takeaways.filter((t) => !t.passed).length} of ${participants.length} shared`}
            >
              Take-aways
            </Eyebrow>
            {!ended && (
              <form onSubmit={share} className="mt-2 flex flex-wrap gap-2">
                <input
                  aria-label="Your take-away"
                  value={text}
                  maxLength={200}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    mine?.text ? `Yours: ${mine.text}` : 'What are you taking away from today?'
                  }
                  className="h-12 min-w-0 flex-1 rounded-xl border-2 border-teal bg-panel px-3 text-[16px]"
                />
                <Button type="submit" className="h-12">
                  {mine && !mine.passed ? 'Update' : 'Share'}
                </Button>
                <Button
                  variant="ghost"
                  className="h-12"
                  onClick={() =>
                    act('set_takeaway', { p_board: state.board_id, p_text: null, p_passed: true })
                  }
                >
                  Pass
                </Button>
              </form>
            )}
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {takeaways.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-3 rounded-xl bg-surface p-3 text-[15px]"
                >
                  <Avatar name={t.author_name} />
                  <span>
                    <b>{t.author_name}</b>{' '}
                    {t.passed ? <span className="text-muted">Passed.</span> : t.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-7">
            <Eyebrow>Actions</Eyebrow>
            <ul className="mt-2 divide-y divide-line-soft rounded-xl border border-line-soft">
              {actions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--teal)]"
                    checked={a.done}
                    disabled={ended}
                    aria-label={`Done: ${a.text}`}
                    onChange={(e) =>
                      act('toggle_action', { p_action: a.id, p_done: e.target.checked })
                    }
                  />
                  <span className={`flex-1 text-[16px] ${a.done ? 'line-through' : ''}`}>
                    {a.text}
                  </span>
                  <span className="text-[14px] font-bold">{a.owner_name ?? ''}</span>
                </li>
              ))}
              {actions.length === 0 && (
                <li className="p-3 text-[15px] text-muted">No actions captured.</li>
              )}
            </ul>
            {!ended && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (
                    newAction.trim() &&
                    (await act('add_action', { p_board: state.board_id, p_text: newAction }))
                  )
                    setNewAction('')
                }}
              >
                <input
                  aria-label="New action"
                  value={newAction}
                  maxLength={140}
                  onChange={(e) => setNewAction(e.target.value)}
                  placeholder="Add an action"
                  className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line bg-panel px-3 text-[15px]"
                />
                <Button type="submit" variant="secondary">
                  Add action
                </Button>
              </form>
            )}
          </div>
        </div>
      }
      side={
        <>
          {!ended && state.phase_ends_at && (
            <ClockPanel
              title="Wrap-up clock"
              remaining={remaining}
              totalMs={state.settings.wrapup_s * 1000}
              paused={state.paused_remaining_ms !== null}
              note="A soft clock. The session ends when the facilitator ends it."
            />
          )}
          <div>
            <h2 className="text-[20px] font-bold">Download the results</h2>
            <p className="mt-1 text-[14px] text-muted">
              Word and Excel downloads arrive in the next build step.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Button disabled>Download Word file</Button>
              <Button disabled>Download Excel file</Button>
            </div>
          </div>
          {isFacilitator && !ended && (
            <div>
              <Button
                variant="ghost"
                className="h-12 w-full border-danger text-danger"
                onClick={() => act('end_session', { p_board: state.board_id })}
              >
                End session
              </Button>
              <p className="mt-2 text-center text-[13px] text-muted">
                Session data is deleted 7 days after the session ends.
              </p>
            </div>
          )}
        </>
      }
    />
  )
}
