import { useEffect, useRef, useState } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import { cards, mergedInto } from '../../lib/session'
import type { Topic } from '../../lib/types'
import { useAtZero } from '../../state/useCountdown'
import { Eyebrow, Layout, PageTitle, TimerButtons, type PhaseProps } from './common'
import { DeleteTopicDialog } from './TopicTools'

const MAX = 160

/** Dots per person suggested in spec section 3 (Xebia): topics divided by two, 1 to 5. */
const suggestDots = (topics: number) => Math.min(5, Math.max(1, Math.round(topics / 2)))

export default function Clarify({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator, act } = ctx
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [deleting, setDeleting] = useState<Topic | null>(null)
  const editField = useRef<HTMLTextAreaElement>(null)
  const topicList = useRef<HTMLUListElement>(null)
  const returnTo = useRef<string | null>(null)
  const list = cards(board.data.topics)
  const pitching = list.find((t) => t.id === state.pitch_topic_id)
  const pitchIndex = pitching ? list.indexOf(pitching) : -1
  const next = list[pitchIndex + 1]
  const dots = suggestDots(list.length)
  const editingId = editing?.id

  // A soft clock: chime at zero, never cut anyone off.
  useAtZero(remaining, state.phase_ends_at, chime)

  // Focus moves into the edit box when it opens and back to its Edit button when it closes.
  useEffect(() => {
    if (editingId) {
      returnTo.current = editingId
      editField.current?.focus()
    } else if (returnTo.current) {
      document.getElementById(`edit-${returnTo.current}`)?.focus()
      returnTo.current = null
    }
  }, [editingId])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)))

  async function saveEdit() {
    if (!editing?.text.trim()) return
    if (await act('edit_topic', { p_topic: editing.id, p_text: editing.text })) setEditing(null)
  }

  return (
    <Layout
      ctx={ctx}
      main={
        <>
          <PageTitle
            title="Here is everything the group wrote"
            intro="Each person pitches their topic in a sentence or two. Do not start the discussion yet."
          />
          {isFacilitator && selected.length === 2 && (
            <div
              className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-urgent bg-panel p-4"
              role="region"
              aria-label="Merge"
            >
              <p className="flex-1 text-[15px]">
                <b>Merge these two?</b> Votes are not split between near-duplicates. You can undo
                until voting starts.
              </p>
              <Button
                onClick={async () => {
                  const [target, source] = selected
                  if (await act('merge_topics', { p_source: source, p_target: target }))
                    setSelected([])
                }}
              >
                Merge 2 selected
              </Button>
              <Button variant="ghost" onClick={() => setSelected([])}>
                Keep separate
              </Button>
            </div>
          )}
          {list.length === 0 ? (
            <p className="mt-8 rounded-xl bg-surface p-6 text-[17px]">
              Nobody added a topic. Continue to voting and on to Discuss, where anyone can add
              topics to the queue.
            </p>
          ) : (
            <ul
              ref={topicList}
              tabIndex={-1}
              aria-label="Topics"
              className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              {list.map((t) => {
                const isPitching = t.id === state.pitch_topic_id
                const isSelected = selected.includes(t.id)
                const children = mergedInto(board.data.topics, t.id)
                const body = (
                  <>
                    {(isPitching || isSelected) && (
                      <span className="mb-2 block text-[13px] font-bold tracking-[0.1em] text-teal">
                        {isPitching ? 'PITCHING NOW' : 'SELECTED'}
                      </span>
                    )}
                    <span id={`text-${t.id}`} className="block text-[17px] font-bold">
                      {t.text}
                    </span>
                    <span className="mt-2 block text-[14px] text-muted">{t.author_name}</span>
                  </>
                )
                return (
                  <li
                    key={t.id}
                    className={`rounded-xl border-2 bg-panel ${isPitching ? 'border-teal bg-teal-soft' : isSelected ? 'border-teal' : 'border-line-soft'}`}
                  >
                    {isFacilitator && editing?.id === t.id ? (
                      <form
                        className="p-4"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void saveEdit()
                        }}
                      >
                        <textarea
                          ref={editField}
                          aria-label="Edit topic"
                          aria-describedby={`edit-count-${t.id}`}
                          value={editing.text}
                          maxLength={MAX}
                          rows={3}
                          onChange={(e) =>
                            setEditing({ id: t.id, text: e.target.value.replace(/\n/g, ' ') })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditing(null)
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void saveEdit()
                            }
                          }}
                          className="w-full resize-none rounded-xl border-2 border-teal bg-panel p-3 text-[17px]"
                        />
                        <p id={`edit-count-${t.id}`} className="mt-1 text-[13px] text-muted">
                          {editing.text.length} of {MAX} characters
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="submit" disabled={!editing.text.trim()}>
                            Save
                          </Button>
                          <Button variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : isFacilitator ? (
                      <>
                        <button
                          type="button"
                          className="w-full p-4 text-left"
                          aria-pressed={isSelected}
                          onClick={() => toggle(t.id)}
                        >
                          {body}
                        </button>
                        {/* Names leave out the topic text (it is the description instead), so the
                            card's select button stays the only one named after the topic. */}
                        <div className="flex flex-wrap gap-2 px-4 pb-4">
                          <Button
                            id={`edit-${t.id}`}
                            variant="ghost"
                            aria-describedby={`text-${t.id}`}
                            onClick={() => setEditing({ id: t.id, text: t.text })}
                          >
                            Edit
                          </Button>
                          {/* Deleting the card being pitched would leave its clock running. */}
                          {!isPitching && (
                            <Button
                              variant="ghost"
                              aria-describedby={`text-${t.id}`}
                              onClick={() => setDeleting(t)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="p-4">{body}</div>
                    )}
                    {children.length > 0 && (
                      <ul className="border-t border-line-soft px-4 py-2">
                        {children.map((c) => (
                          <li key={c.id} className="flex items-center gap-2 py-1 text-[14px]">
                            <span className="flex-1">
                              + {c.text} <span className="text-muted">({c.author_name})</span>
                            </span>
                            {isFacilitator && (
                              <button
                                type="button"
                                className="min-h-11 px-2 font-bold text-teal underline"
                                onClick={() => act('unmerge_topic', { p_topic: c.id })}
                              >
                                Undo merge
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      }
      side={
        <>
          {pitching && state.settings.pitch_s > 0 ? (
            <ClockPanel
              title={`${pitching.author_name} is pitching`}
              remaining={remaining}
              totalMs={state.settings.pitch_s * 1000}
              paused={state.paused_remaining_ms !== null}
              note="A soft clock. It chimes at zero but never cuts anyone off."
            />
          ) : (
            <div>
              <Eyebrow>Pitches</Eyebrow>
              <p className="mt-2 text-[15px]">
                {pitching
                  ? `${pitching.author_name} is pitching.`
                  : 'Each author explains their card in a sentence or two.'}
              </p>
            </div>
          )}
          {isFacilitator && pitching && state.settings.pitch_s > 0 && (
            <TimerButtons ctx={ctx} addSeconds={15} />
          )}
          {isFacilitator && list.length > 0 && (
            <div className="flex flex-col gap-2">
              <Button
                className="h-12"
                disabled={!next}
                onClick={() => act('set_pitch', { p_board: state.board_id, p_topic: next?.id })}
              >
                {pitching ? (next ? 'Next pitch' : 'Last pitch done') : 'Start pitches'}
              </Button>
              {pitching ? (
                <Button
                  variant="secondary"
                  onClick={() => act('set_pitch', { p_board: state.board_id, p_topic: null })}
                >
                  Stop pitching
                </Button>
              ) : (
                // When the cards already speak for themselves, go straight to voting.
                <Button
                  variant="secondary"
                  onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'vote' })}
                >
                  Skip pitches
                </Button>
              )}
            </div>
          )}
          {isFacilitator && (
            <div>
              <Eyebrow>Tidying up</Eyebrow>
              <p className="mt-2 text-[15px]">
                Select two cards and press Merge. The first one you select keeps its place. You can
                undo a merge until voting starts.
              </p>
            </div>
          )}
          {isFacilitator && list.length > 0 && (
            <div>
              <Eyebrow right={`${state.settings.dots} each`}>Dots per person</Eyebrow>
              <p className="mt-2 text-[15px]">
                Suggested: {dots} {dots === 1 ? 'dot' : 'dots'} each (topics / 2, at most 5)
              </p>
              {/* Stays on screen once applied, so keyboard focus is not lost. */}
              <Button
                variant="secondary"
                className="mt-2"
                disabled={state.settings.dots === dots}
                onClick={() =>
                  act('update_settings', { p_board: state.board_id, p_settings: { dots } })
                }
              >
                {state.settings.dots === dots ? 'Using' : 'Use'} {dots}{' '}
                {dots === 1 ? 'dot' : 'dots'}
              </Button>
            </div>
          )}
          {isFacilitator && (
            <div>
              <Button
                className="h-14 w-full text-[17px]"
                onClick={() => act('start_phase', { p_board: state.board_id, p_phase: 'vote' })}
              >
                Continue to voting
              </Button>
              <p className="mt-2 text-center text-[13px] text-muted">
                Opens {state.settings.dots} dots each and a {Math.floor(state.settings.vote_s / 60)}
                :{String(state.settings.vote_s % 60).padStart(2, '0')} clock.
              </p>
            </div>
          )}
          <DeleteTopicDialog
            ctx={ctx}
            topic={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              setSelected((ids) => ids.filter((id) => id !== deleting?.id))
              topicList.current?.focus()
            }}
          />
        </>
      }
    />
  )
}
