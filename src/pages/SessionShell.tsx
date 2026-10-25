import { useState } from 'react'
import { PHASES, type Phase } from '../lib/types'
import { PHASE_LABEL, type BoardContext } from './BoardView'

/** Session screens share a phase stepper and the Stage/Board toggle; phase screens arrive in Phase 3. */
export default function SessionShell({ ctx }: { ctx: BoardContext }) {
  const { state } = ctx
  const [view, setView] = useState<'stage' | 'board'>('stage')
  const steps: Phase[] = PHASES.filter((p) => p !== 'lobby' && p !== 'ended')
  const current = steps.indexOf(state.phase)

  return (
    <>
      <nav
        aria-label="Session progress"
        className="flex h-[88px] shrink-0 items-center gap-4 border-b border-line-soft px-4 sm:px-10"
      >
        <ol className="flex flex-1 gap-2 overflow-x-auto">
          {steps.map((p, i) => (
            <li
              key={p}
              aria-current={i === current ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-[15px] font-bold ${i === current ? 'bg-teal text-on-teal' : i < current ? 'text-teal' : 'text-muted'}`}
            >
              <span>{i + 1}</span>
              {PHASE_LABEL[p]}
            </li>
          ))}
        </ol>
        <div role="tablist" aria-label="View" className="flex rounded-xl border-2 border-line p-1">
          {(['stage', 'board'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-11 rounded-lg px-4 text-[15px] font-bold ${view === v ? 'bg-teal-soft text-teal' : ''}`}
            >
              {v === 'stage' ? 'Stage' : 'Board'}
            </button>
          ))}
        </div>
      </nav>
      <main className="flex-1 p-10">
        <h1 className="text-[32px] font-extrabold">{PHASE_LABEL[state.phase]}</h1>
        <p className="mt-2 text-[17px] text-muted">
          {view === 'stage' ? 'Stage view' : 'Board view'} for this step is built in the next phase.
        </p>
      </main>
    </>
  )
}
