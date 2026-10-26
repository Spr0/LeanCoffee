import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { Dialog } from '../../components/session/Dialog'
import { PeopleButton } from '../../components/session/People'
import { Avatar, Button } from '../../components/ui'
import { download } from '../../lib/export/download'
import { topicLeftNote } from '../../lib/export/model'
import { boardTotals, cards, discussProgress, plural } from '../../lib/session'
import { formatClock } from '../../lib/time'
import type { Topic } from '../../lib/types'
import type { BoardData } from '../../state/useBoard'
import { useNow } from '../../state/useNow'
import { ActionList, DiscussedColumn } from './BoardColumns'
import {
  ACCENT_CHIP,
  ACTION_MAX,
  ActionCount,
  BoardFrame,
  Eyebrow,
  FILL_LEFT,
  FILL_RIGHT,
  SessionTime,
  SideColumn,
  STAGE_TITLE,
  TimerButtons,
  type PhaseProps,
  useLiveNote,
  useRefocus,
} from './common'
import { DownloadsButton } from './Downloads'
import { OwnerField, ownerName } from './OwnerField'

// The stage's page heading when it says what to do, the same size in every phase.

/**
 * Wrap-up as the final board: Not discussed on the left, take-aways, the downloads, End session
 * and new actions on the stage, and every discussed topic with its actions on the right. The
 * downloads are in the toolbar too, as from the Vote reveal on. The ended board is the same,
 * read-only (spec F25, decision D61): no inputs, done boxes disabled, downloads kept.
 */
export default function WrapUp({ ctx, remaining }: PhaseProps) {
  const { board, state, isFacilitator } = ctx
  const { topics, votes, actions } = board.data
  const ended = state.phase === 'ended'
  const now = useNow(10_000)
  const endMs = state.ended_at ? Date.parse(state.ended_at) : now + board.offsetMs
  const totals = boardTotals(votes, topics, state.base_round)
  const [note, setNote] = useLiveNote()
  // Ending the session takes the forms and the pressed button away: focus goes to the heading.
  const { area: stageRef, target: headingRef } = useRefocus<HTMLElement, HTMLHeadingElement>(
    state.phase,
  )

  return (
    <BoardFrame
      progress={
        <>
          <p className="text-[15px] font-bold">{discussProgress(topics)}</p>
          <SessionTime
            state={state}
            nowMs={endMs}
            extra={` · ${plural(actions.length, 'action')}`}
          />
        </>
      }
      tools={
        <>
          <PeopleButton ctx={ctx} />
          {/* The soft clock's buttons, here so the shared take-aways come up the share. */}
          {isFacilitator && !ended && <TimerButtons ctx={ctx} />}
          <DownloadsButton data={board.data} />
        </>
      }
      left={<NotDiscussedColumn ctx={ctx} totals={totals} readOnly={ended} />}
      stageLabel={ended ? 'Session ended' : 'Wrap-up'}
      stageRef={stageRef}
      stage={
        ended ? (
          <EndedStage ctx={ctx} heading={headingRef} onNote={setNote} />
        ) : (
          <WrapUpStage ctx={ctx} remaining={remaining} heading={headingRef} onNote={setNote} />
        )
      }
      right={
        <DiscussedColumn
          ctx={ctx}
          totals={totals}
          onNote={setNote}
          className={FILL_RIGHT}
          readOnly={ended}
        />
      }
      note={note}
    />
  )
}

/**
 * The stage in Wrap-up: the soft clock as a ring like every other phase's, take-aways with the
 * downloads and End session (before new actions, as in the mockup), then new actions.
 */
function WrapUpStage({
  ctx,
  remaining,
  heading,
  onNote,
}: {
  ctx: PhaseProps['ctx']
  remaining: number | null
  heading: RefObject<HTMLHeadingElement | null>
  onNote: (message: string) => void
}) {
  const { board, state, isFacilitator, act } = ctx
  const [newAction, setNewAction] = useState('')
  const [owner, setOwner] = useState('')
  // Kept here so End session can say when your own take-away is still unsent.
  const [takeaway, setTakeaway] = useState('')
  const actionField = useRef<HTMLInputElement>(null)
  const paused = state.paused_remaining_ms !== null
  const clock = state.phase_ends_at !== null || paused
  const totalMs = Math.max(state.settings.wrapup_s * 1000, remaining ?? 0)

  async function addAction(e: FormEvent) {
    e.preventDefault()
    // Spaces alone would be refused silently, and the button would look broken.
    if (!newAction.trim()) {
      setNewAction('')
      actionField.current?.focus()
      onNote('Write an action first.')
      return
    }
    if (
      board.data.actions.length < ACTION_MAX &&
      (await act('add_action', {
        p_board: state.board_id,
        p_text: newAction,
        p_owner_name: ownerName(owner),
      }))
    ) {
      setNewAction('')
      setOwner('')
      onNote('Action added under Other actions, in Discussed.')
    }
  }

  return (
    <>
      {/* The facilitator's clock buttons are in the toolbar, so the take-aways come up the share. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 grow basis-64">
          <span className={ACCENT_CHIP}>WRAPPING UP</span>
          <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
            Nice work. Capture what you are taking away.
          </h1>
          <p className="mt-2 text-[16px] text-muted">
            One line each. Passing is fine.
            {clock && ' The clock is soft: the session ends when the facilitator ends it.'}
          </p>
        </div>
        {clock && (
          // Centered when it wraps under the heading, as on a phone.
          <div className="mx-auto">
            <RingTimer
              remaining={remaining}
              totalMs={totalMs}
              paused={paused}
              size={formatClock(totalMs).length > 4 ? 240 : 200}
            />
          </div>
        )}
      </div>
      {/* The downloads and End session come straight after the take-away box, before the
          shared take-aways, so a long list cannot push them off a 720 px share. */}
      <Takeaways
        ctx={ctx}
        onNote={onNote}
        draft={[takeaway, setTakeaway]}
        footer={
          <p className="mt-2 text-[13px] text-muted">
            Anyone in the session can download the files. Session data is deleted 7 days after the
            session ends.
          </p>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DownloadButtons data={board.data} onNote={onNote} />
          {isFacilitator && (
            <EndSessionButton
              ctx={ctx}
              unsent={[
                takeaway.trim() && 'Your take-away is not shared yet.',
                newAction.trim() && 'Your new action is not added yet.',
              ].filter((x): x is string => !!x)}
            />
          )}
        </div>
      </Takeaways>
      <div className="mt-6">
        <Eyebrow>New actions</Eyebrow>
        <form onSubmit={addAction} className="mt-2 flex flex-wrap gap-2">
          <input
            ref={actionField}
            aria-label="New action"
            dir="auto"
            value={newAction}
            maxLength={140}
            onChange={(e) => setNewAction(e.target.value)}
            placeholder="Add an action"
            className="h-12 min-w-0 grow basis-60 rounded-xl border-2 border-line-strong bg-panel px-3 text-[16px]"
          />
          <OwnerField
            value={owner}
            onChange={setOwner}
            people={board.data.participants}
            className="h-12 rounded-xl"
          />
          <Button
            type="submit"
            className="h-12 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={board.data.actions.length >= ACTION_MAX || undefined}
          >
            Add action
          </Button>
        </form>
        <ActionCount count={board.data.actions.length} />
      </div>
    </>
  )
}

/** The stage once the session has ended: the downloads and the take-aways, read-only. */
function EndedStage({
  ctx,
  heading,
  onNote,
}: {
  ctx: PhaseProps['ctx']
  heading: RefObject<HTMLHeadingElement | null>
  onNote: (message: string) => void
}) {
  return (
    <>
      <span className={ACCENT_CHIP}>SESSION ENDED</span>
      <h1 ref={heading} tabIndex={-1} className={`mt-3 ${STAGE_TITLE}`}>
        This session has ended
      </h1>
      <p className="mt-2 text-[16px] text-muted">
        The board is read-only. Download the results before it is deleted.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DownloadButtons data={ctx.board.data} onNote={onNote} />
      </div>
      <p className="mt-2 text-[13px] text-muted">
        Anyone in the session can download the files. Session data is deleted 7 days after the
        session ended.
      </p>
      <Takeaways ctx={ctx} readOnly />
    </>
  )
}

/**
 * Take-aways: one line each or a pass (spec section 3), and everyone's so far. `children` go
 * between the box and the list.
 */
function Takeaways({
  ctx,
  onNote = () => {},
  readOnly = false,
  draft,
  children,
  footer,
}: {
  ctx: PhaseProps['ctx']
  onNote?: (message: string) => void
  readOnly?: boolean
  /** The take-away being typed, when the stage needs to know about it. */
  draft?: [string, (text: string) => void]
  children?: ReactNode
  /** After the shared take-aways. */
  footer?: ReactNode
}) {
  const { board, state, userId, act } = ctx
  const { takeaways, participants } = board.data
  const own = useState('')
  const [text, setText] = draft ?? own
  const field = useRef<HTMLInputElement>(null)
  const mine = takeaways.find((t) => t.user_id === userId)
  const shared = takeaways.filter((t) => !t.passed).length
  // Someone removed after sharing keeps their take-away on the board, so they still count.
  const people = new Set([
    ...participants.map((p) => p.user_id),
    ...takeaways.map((t) => t.user_id),
  ]).size

  async function share(e: FormEvent) {
    e.preventDefault()
    // Spaces alone would be refused silently, and the button would look broken.
    if (!text.trim()) {
      setText('')
      field.current?.focus()
      onNote('Write a take-away first, or press Pass.')
      return
    }
    if (await act('set_takeaway', { p_board: state.board_id, p_text: text })) {
      setText('')
      onNote('Your take-away is shared.')
    }
  }

  return (
    <div className="mt-6">
      <Eyebrow right={`${shared} of ${people} shared`}>Take-aways</Eyebrow>
      {!readOnly && (
        <form onSubmit={share} className="mt-2 flex flex-wrap gap-2">
          <input
            ref={field}
            aria-label="Your take-away"
            dir="auto"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mine?.text ? `Yours: ${mine.text}` : 'What are you taking away from today?'
            }
            className="h-12 min-w-0 flex-1 basis-60 rounded-xl border-2 border-teal bg-panel px-3 text-[16px]"
          />
          <Button type="submit" className="h-12">
            {mine && !mine.passed ? 'Update' : 'Share'}
          </Button>
          <Button
            variant="ghost"
            className="h-12"
            onClick={async () => {
              if (
                await act('set_takeaway', {
                  p_board: state.board_id,
                  p_text: null,
                  p_passed: true,
                })
              )
                onNote('You passed.')
            }}
          >
            Pass
          </Button>
        </form>
      )}
      {children}
      {takeaways.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted">
          {readOnly ? 'No take-aways were shared.' : 'Nobody has shared one yet.'}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 @lg:grid-cols-2">
          {takeaways.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-xl bg-surface p-3 text-[15px] dark:bg-ground"
            >
              <Avatar name={t.author_name} />
              <span className="min-w-0 wrap-anywhere">
                <b>
                  <bdi>{t.author_name}</bdi>
                </b>{' '}
                {t.passed ? <span className="text-muted">Passed.</span> : <bdi>{t.text}</bdi>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </div>
  )
}

/**
 * End session in Wrap-up asks first, as it does in every other phase (D69): it cannot be undone,
 * and whatever people are still typing is lost. It says who has not shared or passed yet, and
 * when the facilitator's own take-away or action is unsent. One press at a time; a second end
 * that lost the race to the first is not an error.
 */
function EndSessionButton({ ctx, unsent }: { ctx: PhaseProps['ctx']; unsent: string[] }) {
  const { board, state, act } = ctx
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { participants, takeaways } = board.data
  const waiting = participants.filter((p) => !takeaways.some((t) => t.user_id === p.user_id))
  return (
    <>
      <Button variant="dangerOutline" className="h-12 sm:ml-auto" onClick={() => setOpen(true)}>
        End session
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="End the session now?">
        <p className="mt-2 text-[15px] text-muted">
          The board becomes read-only for everyone. Downloads stay available.
        </p>
        {waiting.length > 0 && (
          <p className="mt-3 text-[15px]">
            {waiting.length === 1
              ? '1 person has not shared a take-away or passed yet.'
              : `${waiting.length} people have not shared a take-away or passed yet.`}{' '}
            Anything they are still typing is lost.
          </p>
        )}
        {unsent.length > 0 && <p className="mt-3 text-[15px] font-bold">{unsent.join(' ')}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="aria-disabled:cursor-wait aria-disabled:opacity-60"
            aria-disabled={busy || undefined}
            onClick={async () => {
              if (busy) return
              setBusy(true)
              const ok = await act(
                'end_session',
                { p_board: state.board_id },
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

const FILES = [
  { kind: 'docx', label: 'Download Word file', done: 'The Word file is ready.' },
  { kind: 'xlsx', label: 'Download Excel file', done: 'The Excel file is ready.' },
] as const

/**
 * The Word and Excel files as buttons on the stage, for everyone (spec F24), also once the
 * session has ended. While a file is built the buttons say so but are not disabled, so the
 * pressed one keeps keyboard focus; the live line says when the file is ready.
 */
function DownloadButtons({ data, onNote }: { data: BoardData; onNote: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {FILES.map((f) => (
        <Button
          key={f.kind}
          className="h-12 aria-disabled:cursor-progress"
          aria-disabled={busy !== null || undefined}
          onClick={async () => {
            if (busy !== null) return
            setBusy(f.kind)
            setError(null)
            try {
              await download(f.kind, data)
              onNote(f.done)
            } catch {
              setError('Could not build the file. Try again.')
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === f.kind ? 'Preparing…' : f.label}
        </Button>
      ))}
      {error && (
        <p role="alert" className="w-full text-[14px] font-bold text-danger">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Left column, Not discussed: the topics left in the queue and those skipped, with their votes
 * and actions. They stay in the files for next time.
 */
/** " · skipped after 0:05" and the like, after the vote count on a Not discussed card. */
function cardNote(t: Topic): string | null {
  const note = topicLeftNote(t)
  return note && ` · ${note}`
}

function NotDiscussedColumn({
  ctx,
  totals,
  readOnly,
}: {
  ctx: PhaseProps['ctx']
  totals: Map<string, number>
  readOnly: boolean
}) {
  const { topics, actions } = ctx.board.data
  const all = cards(topics)
  const left = [
    ...all.filter((t) => t.status === 'open'),
    ...all.filter((t) => t.status === 'skipped'),
  ]
  const headingId = useId()
  return (
    <SideColumn label="Not discussed" className={FILL_LEFT}>
      <h2 id={headingId} className="flex justify-between px-1 text-[17px] font-bold">
        Not discussed <span className="text-muted">{left.length}</span>
      </h2>
      {left.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          {all.length === 0 ? 'No topics were added.' : 'Every topic on the board was discussed.'}
        </p>
      ) : (
        <>
          {/* Skipped is said in words and by a dashed edge, not by color alone. */}
          <ul aria-labelledby={headingId} className="mt-2 flex flex-col gap-2">
            {left.map((t) => (
              <li
                key={t.id}
                className={`rounded-xl border-2 bg-panel p-3 ${t.status === 'skipped' ? 'border-dashed border-line' : 'border-line-soft'}`}
              >
                <p dir="auto" className="text-[15px] leading-snug font-bold wrap-anywhere">
                  {t.text}
                </p>
                <p className="mt-1 text-[13px] wrap-anywhere text-muted">
                  <bdi>{t.author_name}</bdi> · {plural(totals.get(t.id) ?? 0, 'vote')}
                  {/* As the Word and Excel files say it (D100), from the same helper. */}
                  {cardNote(t)}
                </p>
                <ActionList
                  ctx={ctx}
                  topic={t}
                  actions={actions.filter((a) => a.topic_id === t.id)}
                  readOnly={readOnly}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 px-1 text-[14px] text-muted">
            These stay in the Word and Excel files, so you can start next time with them.
          </p>
        </>
      )}
    </SideColumn>
  )
}
