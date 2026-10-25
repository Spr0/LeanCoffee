import { useEffect, useRef, useState } from 'react'
import { Avatar, Button, Eyebrow, Stepper, Switch } from '../components/ui'
import { readRecoveryToken, recoveryLink } from '../lib/recovery'
import { formatClock, isPresent } from '../lib/time'
import type { Settings } from '../lib/types'
import { useNow } from '../state/useNow'
import type { BoardContext } from './BoardView'

const LENGTHS = [30, 45, 60, 75]
const TIE_LABELS: Record<Settings['tie_break'], string> = {
  drag: 'Facilitator decides',
  mini_vote: 'Quick one-dot vote',
  random: 'Random draw',
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key)
        window.setTimeout(() => setCopied(null), 2000)
      },
      () => setCopied(null),
    )
  }
  return [copied, copy]
}

export default function Lobby({ ctx }: { ctx: BoardContext }) {
  const { board, state, userId, code, isFacilitator, act } = ctx
  const s = state.settings
  const boardId = state.board_id
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(state.name)
  const [passcodeDraft, setPasscodeDraft] = useState('')
  const [passcodeOpen, setPasscodeOpen] = useState(false)
  const [copied, copy] = useCopy()
  const nameInput = useRef<HTMLInputElement>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)

  // Move focus into the rename field when it opens, and back to the pencil when it closes.
  useEffect(() => {
    if (editingName) nameInput.current?.focus()
    else if (wasEditing.current) renameButton.current?.focus()
    wasEditing.current = editingName
  }, [editingName])

  const now = useNow(5000)
  const here = board.data.participants
    .filter((p) => isPresent(p.last_seen_at, now, board.offsetMs))
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
  const facilitator = board.data.participants.find((p) => p.user_id === state.facilitator_user_id)
  const link = `${window.location.origin}/b/${code}`
  const token = state.owner_user_id === userId ? readRecoveryToken(boardId) : null

  const set = (patch: Partial<Settings>) =>
    act('update_settings', { p_board: boardId, p_settings: patch })

  return (
    <main className="mx-auto grid w-full max-w-[1440px] gap-10 px-4 py-6 sm:px-10 lg:grid-cols-[1fr_620px]">
      <section>
        <div className="flex items-center gap-3">
          {editingName ? (
            <form
              className="flex flex-1 gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await act('update_settings', { p_board: boardId, p_name: nameDraft }))
                  setEditingName(false)
              }}
            >
              <input
                ref={nameInput}
                aria-label="Session name"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="h-12 flex-1 rounded-xl border-2 border-line bg-panel px-3 text-[22px] font-bold"
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              <Button type="submit">Save</Button>
              <Button variant="ghost" onClick={() => setEditingName(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <h1 className="text-[36px] leading-tight font-extrabold">
                {state.name || 'Lean Coffee'}
              </h1>
              {isFacilitator && (
                <button
                  type="button"
                  ref={renameButton}
                  aria-label="Rename board"
                  className="flex size-11 items-center justify-center rounded-lg text-muted"
                  onClick={() => {
                    setNameDraft(state.name)
                    setEditingName(true)
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-2 text-[15px] font-bold">Planned length</span>
          {isFacilitator ? (
            LENGTHS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={state.planned_minutes === m}
                onClick={() => act('update_settings', { p_board: boardId, p_planned_minutes: m })}
                className={`h-11 min-w-12 rounded-lg border-2 px-3 text-[15px] font-bold ${state.planned_minutes === m ? 'border-teal bg-teal-soft text-teal' : 'border-line bg-panel'}`}
              >
                {m}
              </button>
            ))
          ) : (
            <span className="text-[15px] font-bold">{state.planned_minutes}</span>
          )}
          <span className="ml-1 text-[15px] text-muted">minutes</span>
        </div>

        <div className="mt-5 rounded-2xl border border-line-soft bg-surface p-6">
          <Eyebrow>Room code</Eyebrow>
          <p
            className="mt-2 text-[44px] font-extrabold tracking-[0.06em] sm:text-[60px]"
            data-testid="room-code"
          >
            {code}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              readOnly
              aria-label="Invite link"
              value={link}
              className="h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-panel px-3 text-[15px] text-muted"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={() => copy('link', link)}>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>

        {token && (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-line-soft p-4">
            <p className="flex-1 text-[14px] text-muted">
              You can hand control to anyone from the people list. The recovery link restores your
              role if your browser closes. Keep it private.
            </p>
            <Button variant="ghost" onClick={() => copy('recovery', recoveryLink(code, token))}>
              {copied === 'recovery' ? 'Copied' : 'Copy recovery link'}
            </Button>
          </div>
        )}

        <div className="mt-6">
          <Eyebrow>
            Here now <span className="ml-1 text-ink">{here.length}</span>
          </Eyebrow>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="People here now">
            {here.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-full border border-line py-1.5 pr-4 pl-1.5 text-[15px]"
              >
                <Avatar name={p.display_name} />
                {p.display_name}
                {p.user_id === userId && <span className="text-muted">(you)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            Built for 3 to 12 people. Names are visible on every topic. Late joiners are welcome.
          </p>
        </div>
      </section>

      <section
        className="rounded-2xl border border-line-soft bg-surface p-6 sm:p-7"
        aria-labelledby="rules-title"
      >
        <h2 id="rules-title" className="text-[22px] font-bold">
          Session rules
        </h2>
        {!isFacilitator && (
          <p className="mt-1 text-[14px] text-muted">
            Set by {facilitator?.display_name ?? 'the facilitator'}.
          </p>
        )}
        <div className="mt-4">
          <Eyebrow>Timers</Eyebrow>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stepper
            label="Brainstorm"
            value={s.brainstorm_s}
            display={formatClock(s.brainstorm_s * 1000)}
            min={120}
            max={600}
            step={30}
            disabled={!isFacilitator}
            onChange={(v) => set({ brainstorm_s: v })}
          />
          <Stepper
            label="Pitch"
            value={s.pitch_s}
            display={s.pitch_s === 0 ? 'Off' : `${s.pitch_s} s`}
            min={0}
            max={60}
            step={15}
            disabled={!isFacilitator}
            onChange={(v) => set({ pitch_s: Math.round(v / 15) * 15 })}
          />
          <Stepper
            label="Voting"
            value={s.vote_s}
            display={formatClock(s.vote_s * 1000)}
            min={30}
            max={180}
            step={30}
            disabled={!isFacilitator}
            onChange={(v) => set({ vote_s: v })}
          />
          <Stepper
            label="Discussion"
            value={s.discuss_s}
            display={formatClock(s.discuss_s * 1000)}
            min={180}
            max={600}
            step={60}
            disabled={!isFacilitator}
            onChange={(v) => set({ discuss_s: v })}
          />
          <Stepper
            label="Extension"
            value={s.extend_s}
            display={formatClock(s.extend_s * 1000)}
            min={60}
            max={300}
            step={30}
            disabled={!isFacilitator}
            onChange={(v) => set({ extend_s: v })}
          />
          <Stepper
            label="Wrap-up"
            value={s.wrapup_s}
            display={s.wrapup_s === 0 ? 'Off' : formatClock(s.wrapup_s * 1000)}
            min={0}
            max={600}
            step={60}
            disabled={!isFacilitator}
            onChange={(v) => set({ wrapup_s: Math.round(v / 60) * 60 })}
          />
        </div>
        <div className="mt-4">
          <Eyebrow>Voting</Eyebrow>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stepper
            label="Dots per person"
            value={s.dots}
            display={String(s.dots)}
            min={1}
            max={5}
            step={1}
            disabled={!isFacilitator}
            onChange={(v) => set({ dots: v })}
          />
          <div className="rounded-xl border border-line-soft bg-panel p-3.5">
            <label className="text-[13px] font-bold" htmlFor="tie-break">
              If votes tie
            </label>
            <select
              id="tie-break"
              className="mt-2 h-11 w-full rounded-lg border-2 border-line bg-panel px-3 text-[15px] font-bold"
              value={s.tie_break}
              disabled={!isFacilitator}
              onChange={(e) => set({ tie_break: e.target.value as Settings['tie_break'] })}
            >
              {Object.entries(TIE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <Eyebrow>Rules</Eyebrow>
        </div>
        <div className="mt-1">
          <Switch
            label="Hide topics until reveal"
            hint="Cards stay private until brainstorming ends"
            checked={s.hide_topics}
            disabled={!isFacilitator}
            onChange={(v) => set({ hide_topics: v })}
          />
          <Switch
            label="Require a passcode"
            hint="Extra barrier if the link is forwarded. Read it out on your shared screen"
            checked={state.requires_passcode || passcodeOpen}
            disabled={!isFacilitator}
            onChange={(v) => {
              if (v) setPasscodeOpen(true)
              else {
                setPasscodeOpen(false)
                void act('set_passcode', { p_board: boardId, p_passcode: null })
              }
            }}
          />
          {isFacilitator && passcodeOpen && !state.requires_passcode && (
            <form
              className="flex gap-2 border-b border-line-soft py-3"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await act('set_passcode', { p_board: boardId, p_passcode: passcodeDraft })) {
                  setPasscodeOpen(false)
                  setPasscodeDraft('')
                }
              }}
            >
              <input
                aria-label="New passcode"
                className="h-11 flex-1 rounded-lg border-2 border-line bg-panel px-3 text-[15px]"
                value={passcodeDraft}
                minLength={6}
                maxLength={64}
                onChange={(e) => setPasscodeDraft(e.target.value)}
                placeholder="At least 6 characters"
              />
              <Button type="submit">Set passcode</Button>
            </form>
          )}
          <Switch
            label="Allow voting on your own topic"
            hint="Off keeps quieter ideas in the running"
            checked={s.own_vote}
            disabled={!isFacilitator}
            onChange={(v) => set({ own_vote: v })}
          />
          <Switch
            label="Auto-start the next topic"
            hint="Off gives time to capture actions first"
            checked={s.auto_start_next}
            disabled={!isFacilitator}
            onChange={(v) => set({ auto_start_next: v })}
          />
        </div>

        {isFacilitator ? (
          <>
            {here.length >= 10 && (
              <p className="mt-4 rounded-lg bg-teal-soft p-3 text-[14px] font-bold">
                Lean Coffee works best with 10 or fewer people. The board takes up to 12.
              </p>
            )}
            <Button
              className="mt-6 h-14 w-full text-[17px]"
              onClick={() => act('start_phase', { p_board: boardId, p_phase: 'brainstorm' })}
            >
              Start brainstorm for {here.length} {here.length === 1 ? 'person' : 'people'}
            </Button>
            <p className="mt-2 text-center text-[13px] text-muted">
              Everyone sees a {formatClock(s.brainstorm_s * 1000)} clock. You start it when people
              are ready.
            </p>
          </>
        ) : (
          <p
            className="mt-6 rounded-xl bg-panel p-4 text-center text-[15px] font-bold"
            aria-live="polite"
          >
            Waiting for {facilitator?.display_name ?? 'the facilitator'} to start the session
          </p>
        )}
      </section>
    </main>
  )
}
