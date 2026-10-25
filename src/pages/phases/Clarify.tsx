import { useState } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { Button } from '../../components/ui'
import { chime } from '../../lib/chime'
import { cards, mergedInto } from '../../lib/session'
import { useAtZero } from '../../state/useCountdown'
import { Eyebrow, Layout, PageTitle, type PhaseProps } from './common'

export default function Clarify({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator, act } = ctx
  const [selected, setSelected] = useState<string[]>([])
  const list = cards(board.data.topics)
  const pitching = list.find((t) => t.id === state.pitch_topic_id)
  const pitchIndex = pitching ? list.indexOf(pitching) : -1
  const next = list[pitchIndex + 1]

  // A soft clock: chime at zero, never cut anyone off.
  useAtZero(remaining, state.phase_ends_at, chime)

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)))

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
              Nobody added a topic. Move on to Discuss to add topics there, or end the session.
            </p>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                    <span className="block text-[17px] font-bold">{t.text}</span>
                    <span className="mt-2 block text-[14px] text-muted">{t.author_name}</span>
                  </>
                )
                return (
                  <li
                    key={t.id}
                    className={`rounded-xl border-2 bg-panel ${isPitching ? 'border-teal bg-teal-soft' : isSelected ? 'border-teal' : 'border-line-soft'}`}
                  >
                    {isFacilitator ? (
                      <button
                        type="button"
                        className="w-full p-4 text-left"
                        aria-pressed={isSelected}
                        onClick={() => toggle(t.id)}
                      >
                        {body}
                      </button>
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
          {isFacilitator && list.length > 0 && (
            <div className="flex flex-col gap-2">
              <Button
                className="h-12"
                disabled={!next}
                onClick={() => act('set_pitch', { p_board: state.board_id, p_topic: next?.id })}
              >
                {pitching ? (next ? 'Next pitch' : 'Last pitch done') : 'Start pitches'}
              </Button>
              {pitching && (
                <Button
                  variant="secondary"
                  onClick={() => act('set_pitch', { p_board: state.board_id, p_topic: null })}
                >
                  Stop pitching
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
        </>
      }
    />
  )
}
