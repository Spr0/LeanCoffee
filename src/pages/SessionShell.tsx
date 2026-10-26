import { useState } from 'react'
import { PhaseStepper, reachedPhase } from '../components/session/Stepper'
import { formatClock } from '../lib/time'
import type { Phase } from '../lib/types'
import { useCountdown } from '../state/useCountdown'
import type { BoardContext } from './BoardView'
import Brainstorm from './phases/Brainstorm'
import Clarify from './phases/Clarify'
import Discuss from './phases/Discuss'
import Vote from './phases/Vote'
import WrapUp from './phases/WrapUp'

export default function SessionShell({ ctx }: { ctx: BoardContext }) {
  const { state, board } = ctx
  const remaining = useCountdown(state, board.offsetMs)
  const hint =
    remaining === null
      ? undefined
      : `${formatClock(remaining)} ${state.paused_remaining_ms !== null ? 'paused' : 'left'}`
  // The phase this tab last saw before the session ended, if it was open then.
  const [seen, setSeen] = useState<Phase>('lobby')
  if (state.phase !== 'ended' && state.phase !== seen) setSeen(state.phase)
  const reached =
    state.phase === 'ended'
      ? reachedPhase(state, board.data.topics, board.data.takeaways.length, seen)
      : undefined
  const props = { ctx, remaining }
  return (
    <>
      <PhaseStepper state={state} currentHint={hint} reached={reached} />
      {state.phase === 'brainstorm' && <Brainstorm {...props} />}
      {state.phase === 'clarify' && <Clarify {...props} />}
      {state.phase === 'vote' && <Vote {...props} />}
      {state.phase === 'discuss' && <Discuss {...props} />}
      {(state.phase === 'wrapup' || state.phase === 'ended') && <WrapUp {...props} />}
    </>
  )
}
