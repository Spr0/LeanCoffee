import { PhaseStepper } from '../components/session/Stepper'
import { formatClock } from '../lib/time'
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
  const hint = remaining === null ? undefined : `${formatClock(remaining)} left`
  const props = { ctx, remaining }
  return (
    <>
      <PhaseStepper state={state} currentHint={hint} />
      {state.phase === 'brainstorm' && <Brainstorm {...props} />}
      {state.phase === 'clarify' && <Clarify {...props} />}
      {state.phase === 'vote' && <Vote {...props} />}
      {state.phase === 'discuss' && <Discuss {...props} />}
      {(state.phase === 'wrapup' || state.phase === 'ended') && <WrapUp {...props} />}
    </>
  )
}
