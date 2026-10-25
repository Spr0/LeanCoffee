import { useState } from 'react'
import { isMuted, setMuted } from '../../lib/chime'
import { isPresent } from '../../lib/time'
import type { BoardContext } from '../../pages/BoardView'
import { useNow } from '../../state/useNow'
import { Avatar, Button, Switch } from '../ui'
import { Dialog } from './Dialog'

/** Sidebar footer: facilitator, handover, people management, sound. */
export function PeoplePanel({ ctx }: { ctx: BoardContext }) {
  const { board, state, userId, isFacilitator, act } = ctx
  const now = useNow(5000)
  const [dialog, setDialog] = useState<'pass' | 'people' | 'end' | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [muted, setMutedState] = useState(isMuted)
  const people = board.data.participants
  const present = people.filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
  const facilitator = people.find((p) => p.user_id === state.facilitator_user_id)
  const others = present.filter((p) => p.user_id !== userId)
  const chosen = others.find((p) => p.user_id === choice)
  const canReclaim = !isFacilitator && state.owner_user_id === userId
  // Spec section 8: everyone else sees when the facilitator's heartbeat has gone quiet.
  const reconnecting =
    !isFacilitator &&
    facilitator !== undefined &&
    !isPresent(facilitator.last_seen_at, now, board.offsetMs)
  // Wrap-up has its own End session button; before that it lives here (spec F25).
  const canEnd = isFacilitator && state.phase !== 'wrapup' && state.phase !== 'ended'

  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-center justify-between text-[15px]">
        <span className="text-muted">Facilitator</span>
        <span className="font-bold">
          {facilitator?.display_name ?? 'Nobody'}
          {isFacilitator && ' (you)'}
          {reconnecting && <span className="font-medium text-muted"> (reconnecting)</span>}
        </span>
      </div>
      <p role="status" className="sr-only">
        {reconnecting ? `The facilitator, ${facilitator.display_name}, is reconnecting.` : ''}
      </p>
      {isFacilitator && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => setDialog('pass')}
            disabled={others.length === 0}
          >
            Pass facilitator role
          </Button>
          <Button variant="ghost" onClick={() => setDialog('people')}>
            Manage people
          </Button>
          {canEnd && (
            // Marked "!": the ghost variant's own border and text colors come later in the CSS.
            <Button
              variant="ghost"
              className="col-span-2 border-danger! text-danger!"
              onClick={() => setDialog('end')}
            >
              End session
            </Button>
          )}
        </div>
      )}
      {canReclaim && (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => act('reclaim_facilitator', { p_board: state.board_id })}
        >
          Take the facilitator role back
        </Button>
      )}
      <div className="mt-3 flex items-center justify-between text-[14px] text-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-teal" />
          {present.length} {present.length === 1 ? 'person' : 'people'} connected
        </span>
        <button
          type="button"
          className="min-h-11 rounded-lg px-2 font-bold text-ink underline"
          aria-pressed={!muted}
          onClick={() => {
            setMuted(!muted)
            setMutedState(!muted)
          }}
        >
          Sound {muted ? 'off' : 'on'}
        </button>
      </div>

      <Dialog
        open={dialog === 'pass'}
        onClose={() => setDialog(null)}
        title="Pass the facilitator role"
      >
        <p className="mt-2 text-[15px] text-muted">
          The new facilitator controls timers, topic order, and phase changes. It takes effect right
          away, and one person drives at a time.
        </p>
        <fieldset className="mt-5 flex flex-col gap-2">
          <legend className="sr-only">New facilitator</legend>
          {others.map((p) => (
            <label
              key={p.id}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 ${choice === p.user_id ? 'border-teal bg-teal-soft' : 'border-line'}`}
            >
              <input
                type="radio"
                name="handover"
                className="size-5 accent-[var(--teal)]"
                checked={choice === p.user_id}
                onChange={() => setChoice(p.user_id)}
              />
              <Avatar name={p.display_name} />
              <span className="text-[16px] font-bold">{p.display_name}</span>
            </label>
          ))}
        </fieldset>
        <p className="mt-4 text-[13px] text-muted">
          {state.owner_user_id === userId
            ? 'You can take the role back from the sidebar at any time.'
            : 'The board creator can take the role back at any time.'}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            disabled={!chosen}
            onClick={async () => {
              if (
                chosen &&
                (await act('pass_facilitator', { p_board: state.board_id, p_to: chosen.user_id }))
              )
                setDialog(null)
            }}
          >
            {chosen ? `Pass to ${chosen.display_name}` : 'Choose someone'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'people'}
        onClose={() => setDialog(null)}
        title="People on this board"
      >
        <ul className="mt-4 flex flex-col gap-2">
          {people.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-line px-4 py-2"
            >
              <Avatar name={p.display_name} />
              <span className="flex-1 text-[16px] font-bold">
                {p.display_name}
                {!isPresent(p.last_seen_at, now, board.offsetMs) && (
                  <span className="ml-2 font-medium text-muted">away</span>
                )}
              </span>
              {p.user_id !== userId && p.user_id !== state.owner_user_id && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    act('remove_participant', { p_board: state.board_id, p_user: p.user_id })
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Switch
            label="Lock the board"
            hint="Nobody new can join. People already here stay."
            checked={state.locked}
            onChange={(v) => act('lock_board', { p_board: state.board_id, p_locked: v })}
          />
          <Switch
            label="Close topic submissions"
            hint="Stops new parking-lot topics during Discuss."
            checked={state.topics_locked}
            onChange={(v) => act('lock_topics', { p_board: state.board_id, p_locked: v })}
          />
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Removing someone cuts off their access immediately. Lock the board too, or they can rejoin
          from the link under a new name.
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setDialog(null)}>Done</Button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'end'} onClose={() => setDialog(null)} title="End the session now?">
        <p className="mt-2 text-[15px] text-muted">
          The board becomes read-only for everyone. Downloads stay available.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            className="bg-danger! text-ground!"
            onClick={async () => {
              if (await act('end_session', { p_board: state.board_id })) setDialog(null)
            }}
          >
            End session now
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
