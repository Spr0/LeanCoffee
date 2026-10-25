import { useState, type FormEvent } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import { callWhenDue } from '../../lib/retry'
import { formatClock } from '../../lib/time'
import { useAtZero } from '../../state/useCountdown'
import { Eyebrow, Layout, PageTitle, TimerButtons, type PhaseProps } from './common'

const MAX = 160
const PER_PERSON = 5

export default function Brainstorm({ ctx, remaining }: PhaseProps) {
  const { board, state, userId, isFacilitator, act } = ctx
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const mine = board.data.topics
    .filter((t) => t.author_user_id === userId)
    .sort((a, b) => a.sort_order - b.sort_order)
  const others = board.data.topics.filter((t) => t.author_user_id !== userId)
  const full = mine.length >= PER_PERSON
  // Brainstorm opens with the clock stopped at the full time until the facilitator starts it (D64).
  const notStarted =
    state.phase_ends_at === null && state.paused_remaining_ms === state.settings.brainstorm_s * 1000
  // Participants hear once that the clock started, but only if they saw it stopped.
  const [sawStopped, setSawStopped] = useState(notStarted)
  if (notStarted && !sawStopped) setSawStopped(true)

  useAtZero(remaining, state.phase_ends_at, () => {
    chime()
    // Any browser closes the phase when the clock ends; the server checks the deadline.
    callWhenDue('close_brainstorm', { p_board: state.board_id })
  })

  async function add(e?: FormEvent) {
    e?.preventDefault()
    if (!text.trim() || full) return
    // Clear at once so a slow reply cannot wipe the next topic being typed.
    const draft = text
    setText('')
    if (!(await act('add_topic', { p_board: state.board_id, p_text: draft }))) setText(draft)
  }

  return (
    <Layout
      ctx={ctx}
      main={
        <div className="max-w-[800px]">
          <PageTitle
            title="Write the topics you want to talk about"
            intro={
              state.settings.hide_topics
                ? 'One idea per card, short enough to read at a glance. Nobody else can see your cards until the clock ends.'
                : 'One idea per card, short enough to read at a glance.'
            }
          />
          <form onSubmit={add} className="mt-6 rounded-2xl border border-line-soft bg-surface p-5">
            <label htmlFor="new-topic" className="text-[15px] font-bold">
              New topic
            </label>
            <textarea
              id="new-topic"
              value={text}
              maxLength={MAX}
              rows={3}
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
                  ? 'You have added 5 topics, the most allowed.'
                  : 'What do you want the group to talk about?'
              }
              className="mt-2 w-full resize-none rounded-xl border-2 border-teal bg-panel p-3 text-[17px] disabled:border-line"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[13px] text-muted">
                {text.length} of {MAX} characters · Press Enter to add
              </p>
              <Button type="submit" disabled={full || !text.trim()}>
                + Add topic
              </Button>
            </div>
          </form>

          <div className="mt-7">
            <Eyebrow right={`${mine.length} of ${PER_PERSON}`}>Your topics</Eyebrow>
            <ul className="mt-3 flex flex-col gap-2">
              {mine.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-xl border border-line-soft bg-panel p-4"
                >
                  {editing?.id === t.id ? (
                    <form
                      className="flex flex-1 flex-col gap-1"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (await act('edit_topic', { p_topic: t.id, p_text: editing.text }))
                          setEditing(null)
                      }}
                    >
                      <div className="flex gap-2">
                        <input
                          aria-label="Edit topic"
                          aria-describedby={`edit-count-${t.id}`}
                          className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line bg-panel px-3 text-[16px]"
                          value={editing.text}
                          maxLength={MAX}
                          onChange={(e) => setEditing({ id: t.id, text: e.target.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                        />
                        <Button type="submit">Save</Button>
                      </div>
                      <p id={`edit-count-${t.id}`} className="text-[13px] text-muted">
                        {editing.text.length} of {MAX} characters
                      </p>
                    </form>
                  ) : (
                    <>
                      <span className="flex-1 text-[17px] font-bold">{t.text}</span>
                      <Button
                        variant="ghost"
                        onClick={() => setEditing({ id: t.id, text: t.text })}
                        aria-label={`Edit "${t.text}"`}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => act('delete_topic', { p_topic: t.id })}
                        aria-label={`Delete "${t.text}"`}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">
              You can edit or delete your cards until the clarify step begins.
            </p>
          </div>

          {!state.settings.hide_topics && others.length > 0 && (
            <div className="mt-7">
              <Eyebrow>Everyone else</Eyebrow>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {others.map((t) => (
                  <li key={t.id} className="rounded-xl border border-line-soft p-4">
                    <p className="text-[16px] font-bold">{t.text}</p>
                    <p className="mt-1 text-[13px] text-muted">{t.author_name}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      side={
        <>
          <ClockPanel
            title="Brainstorm clock"
            remaining={remaining}
            totalMs={state.settings.brainstorm_s * 1000}
            paused={state.paused_remaining_ms !== null && !notStarted}
          />
          {!isFacilitator && (
            <p
              role="status"
              className={
                notStarted ? 'rounded-xl bg-teal-soft p-4 text-[15px] font-bold' : 'sr-only'
              }
            >
              {notStarted
                ? 'The clock starts when the facilitator is ready.'
                : sawStopped
                  ? 'The clock has started.'
                  : ''}
            </p>
          )}
          <p className="text-[16px] font-bold" aria-live="polite">
            {state.topic_count} {state.topic_count === 1 ? 'topic' : 'topics'} so far
          </p>
          {state.settings.hide_topics && (
            <p className="rounded-xl bg-teal-soft p-4 text-[14px]">
              Topics are revealed to everyone at once when the clock ends.
            </p>
          )}
          {isFacilitator && (
            <div className="flex flex-col gap-2">
              {notStarted ? (
                <>
                  <Button
                    className="h-14 text-[17px]"
                    onClick={() => act('timer_resume', { p_board: state.board_id })}
                  >
                    Start the {formatClock(state.settings.brainstorm_s * 1000)} clock
                  </Button>
                  <p className="mb-2 text-[13px] text-muted">
                    People can add topics before you start it.
                  </p>
                </>
              ) : (
                <TimerButtons ctx={ctx} />
              )}
              <Button
                className="h-12"
                variant={notStarted ? 'secondary' : 'primary'}
                onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'clarify' })}
              >
                End brainstorm now
              </Button>
            </div>
          )}
        </>
      }
    />
  )
}
