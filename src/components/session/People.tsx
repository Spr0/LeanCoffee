import { useEffect, useRef, useState } from 'react'
import { isMuted, setMuted } from '../../lib/chime'
import { isPresent } from '../../lib/time'
import type { Participant } from '../../lib/types'
import type { BoardContext } from '../../pages/BoardView'
import { useNow } from '../../state/useNow'
import { Avatar, Button, Switch } from '../ui'
import { Dialog } from './Dialog'

const RECONNECTING_AFTER_MS = 90_000

/** The facilitator first, then everyone in the order they joined. */
export function byJoin(people: Participant[], facilitatorId: string | null): Participant[] {
  return [...people].sort(
    (a, b) =>
      Number(b.user_id === facilitatorId) - Number(a.user_id === facilitatorId) ||
      a.joined_at.localeCompare(b.joined_at),
  )
}

/** Who is connected, and whether the facilitator's heartbeat has gone quiet. */
function usePresence(ctx: BoardContext) {
  const { board, state, isFacilitator } = ctx
  const now = useNow(5000)
  const people = byJoin(board.data.participants, state.facilitator_user_id)
  const present = people.filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
  const facilitator = people.find((p) => p.user_id === state.facilitator_user_id)
  // Spec section 8: everyone else sees when the facilitator's heartbeat has gone quiet. Browsers
  // slow timers in hidden tabs to about once a minute, so wait 90 s before saying so.
  const reconnecting =
    !isFacilitator &&
    state.phase !== 'ended' &&
    facilitator !== undefined &&
    !isPresent(facilitator.last_seen_at, now, board.offsetMs, RECONNECTING_AFTER_MS)
  const notice = reconnecting
    ? `The facilitator, ${facilitator.display_name}, is reconnecting.`
    : ''
  return { now, people, present, facilitator, reconnecting, notice }
}

/**
 * Facilitator, handover, people management, sound: the sidebar footer, or the body of the people
 * dialog in Discuss, where the toolbar shows and announces "(reconnecting)" instead.
 */
export function PeoplePanel({ ctx, inDialog = false }: { ctx: BoardContext; inDialog?: boolean }) {
  const { board, state, userId, isFacilitator, act } = ctx
  const { now, people, present, facilitator, reconnecting, notice } = usePresence(ctx)
  const [dialog, setDialog] = useState<'pass' | 'people' | null>(null)
  // The facilitator's dialogs close for good when the role moves away, so nothing in them can be
  // pressed and they do not reopen if it comes back.
  if (!isFacilitator && dialog !== null) setDialog(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const manageTitle = useRef<HTMLHeadingElement>(null)
  // After Cancel, focus goes back to the Remove button that asked.
  const returnTo = useRef<string | null>(null)
  const [muted, setMutedState] = useState(isMuted)
  const others = present.filter((p) => p.user_id !== userId)
  const chosen = others.find((p) => p.user_id === choice)
  const canReclaim = !isFacilitator && state.owner_user_id === userId
  // Wrap-up has its own End session button; before that it lives here (spec F25).
  const canEnd = isFacilitator && state.phase !== 'wrapup' && state.phase !== 'ended'

  return (
    <div className={inDialog ? '' : 'border-t border-line pt-4'}>
      <div className="flex items-center justify-between text-[15px]">
        <span className="text-muted">Facilitator</span>
        <span className="font-bold">
          {facilitator ? <bdi>{facilitator.display_name}</bdi> : 'Nobody'}
          {isFacilitator && ' (you)'}
          {reconnecting && <span className="font-medium text-muted"> (reconnecting)</span>}
        </span>
      </div>
      {!inDialog && (
        <p role="status" className="sr-only">
          {notice}
        </p>
      )}
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
          {canEnd && <EndSession ctx={ctx} className="col-span-2" />}
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
        {/* The words say the state; a pressed state as well read as "Sound off, not pressed". */}
        <button
          type="button"
          className="min-h-11 rounded-lg px-2 font-bold text-ink underline"
          onClick={() => {
            setMuted(!muted)
            setMutedState(!muted)
          }}
        >
          Sound {muted ? 'off' : 'on'}
        </button>
      </div>

      <Dialog
        open={isFacilitator && dialog === 'pass'}
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
              <span className="text-[16px] font-bold">
                <bdi>{p.display_name}</bdi>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="mt-4 text-[13px] text-muted">
          {state.owner_user_id === userId
            ? 'You can take the role back at any time.'
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
            {chosen ? (
              <>
                Pass to <bdi>{chosen.display_name}</bdi>
              </>
            ) : (
              'Choose someone'
            )}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={isFacilitator && dialog === 'people'}
        onClose={() => {
          setDialog(null)
          setConfirming(null)
        }}
        title="People on this board"
        titleRef={manageTitle}
      >
        <ul aria-label="People on this board" className="mt-4 flex flex-col gap-2">
          {people.map((p) => {
            const self = p.user_id === userId
            const creator = p.user_id === state.owner_user_id
            const asking = confirming === p.user_id
            return (
              <li
                key={p.id}
                className="flex min-h-[62px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-4 py-2"
              >
                <Avatar name={p.display_name} />
                <span className="min-w-0 flex-1 text-[16px] font-bold break-words">
                  <bdi>{p.display_name}</bdi>
                  {!isPresent(p.last_seen_at, now, board.offsetMs) && (
                    <span className="ml-2 font-medium text-muted">away</span>
                  )}
                </span>
                {self || creator ? (
                  <span className="text-[14px] text-muted">{self ? 'You' : 'Board creator'}</span>
                ) : asking ? (
                  <RemoveConfirm
                    name={p.display_name}
                    onCancel={() => {
                      returnTo.current = p.user_id
                      setConfirming(null)
                    }}
                    onRemove={async () => {
                      if (
                        await act('remove_participant', {
                          p_board: state.board_id,
                          p_user: p.user_id,
                        })
                      ) {
                        setConfirming(null)
                        // The row goes once the list reloads; focus waits at the top.
                        manageTitle.current?.focus()
                      }
                    }}
                  />
                ) : (
                  // The name starts with the visible word (WCAG 2.5.3) and says who goes.
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${p.display_name}`}
                    ref={(el) => {
                      if (el && returnTo.current === p.user_id) {
                        returnTo.current = null
                        el.focus()
                      }
                    }}
                    onClick={() => setConfirming(p.user_id)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            )
          })}
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
          <Button variant="ghost" onClick={() => setDialog(null)}>
            Done
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

/**
 * Removing someone asks first, in their row: focus moves to Cancel, so a second Enter on Remove
 * cannot cut anyone off.
 */
function RemoveConfirm({
  name,
  onCancel,
  onRemove,
}: {
  name: string
  onCancel: () => void
  onRemove: () => Promise<void>
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => cancel.current?.focus(), [])
  return (
    <div
      role="group"
      aria-label={`Remove ${name}?`}
      className="flex basis-full flex-wrap items-center justify-end gap-2"
    >
      <span className="mr-auto text-[15px] font-bold">Remove {name}?</span>
      <Button ref={cancel} variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="danger"
        aria-disabled={busy || undefined}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          await onRemove()
          setBusy(false)
        }}
      >
        Remove {name}
      </Button>
    </div>
  )
}

/**
 * Discuss toolbar: faces of the people connected and an "N people" button that opens the people
 * panel in a dialog. "(reconnecting)" shows here as well, since the dialog is usually closed.
 */
export function PeopleButton({ ctx }: { ctx: BoardContext }) {
  const { present, facilitator, reconnecting, notice } = usePresence(ctx)
  const [open, setOpen] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  // Passing or losing the facilitator role removes the control that had focus in the open dialog.
  useEffect(() => {
    const active = document.activeElement
    if (open && (active === null || active === document.body)) title.current?.focus()
  }, [open, ctx.isFacilitator])
  return (
    <>
      {reconnecting && (
        <span className="text-[15px] text-muted">
          Facilitator{' '}
          <b className="text-ink">
            <bdi>{facilitator?.display_name}</bdi>
          </b>{' '}
          (reconnecting)
        </span>
      )}
      <p role="status" className="sr-only">
        {notice}
      </p>
      <span className="hidden -space-x-1.5 sm:flex" aria-hidden="true">
        {present.slice(0, 6).map((p) => (
          <Avatar key={p.id} name={p.display_name} />
        ))}
      </span>
      <Button variant="ghost" className="px-3" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {present.length} {present.length === 1 ? 'person' : 'people'}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="People" titleRef={title}>
        <ul aria-label="People connected" className="mt-4 flex flex-wrap gap-2">
          {present.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[15px] font-bold"
            >
              <Avatar name={p.display_name} />
              <bdi>{p.display_name}</bdi>
            </li>
          ))}
        </ul>
        <div className="mt-5">
          <PeoplePanel ctx={ctx} inDialog />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </Dialog>
    </>
  )
}

/** Facilitator: end the session from any phase before Wrap-up, after a confirmation (spec F25). */
export function EndSession({ ctx, className = '' }: { ctx: BoardContext; className?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button variant="dangerOutline" className={className} onClick={() => setOpen(true)}>
        End session
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="End the session now?">
        <p className="mt-2 text-[15px] text-muted">
          The board becomes read-only for everyone. Downloads stay available.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (busy) return
              setBusy(true)
              // A second press, or another tab that ended it first, is not an error to show.
              const ok = await ctx.act(
                'end_session',
                { p_board: ctx.state.board_id },
                { quiet: ['invalid_phase_order'] },
              )
              setBusy(false)
              if (ok) setOpen(false)
            }}
          >
            End session now
          </Button>
        </div>
      </Dialog>
    </>
  )
}
