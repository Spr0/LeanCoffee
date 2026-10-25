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
  const [dialog, setDialog] = useState<'pass' | 'people' | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [muted, setMutedState] = useState(isMuted)
  const people = board.data.participants
  const present = people.filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
  const facilitator = people.find((p) => p.user_id === state.facilitator_user_id)
  const others = present.filter((p) => p.user_id !== userId)
  const chosen = others.find((p) => p.user_id === choice)
  const canReclaim = !isFacilitator && state.owner_user_id === userId

  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-center justify-between text-[15px]">
        <span className="text-muted">Facilitator</span>
        <span className="font-bold">
          {facilitator?.display_name ?? 'Nobody'}
          {isFacilitator && ' (you)'}
        </span>
      </div>
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
    </div>
  )
}
