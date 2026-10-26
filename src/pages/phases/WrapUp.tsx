import { useId, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { RingTimer } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Avatar, Button } from '../../components/ui'
import { download } from '../../lib/export/download'
import { boardTotals, cards, discussProgress, plural } from '../../lib/session'
import { formatClock } from '../../lib/time'
import type { BoardData } from '../../state/useBoard'
import { useNow } from '../../state/useNow'
import { ActionList, DiscussedColumn } from './BoardColumns'
import {
  ACCENT_CHIP,
  BoardFrame,
  Eyebrow,
  FILL_LEFT,
  FILL_RIGHT,
  SessionTime,
  SideColumn,
  TimerButtons,
  useLiveNote,
  useRefocus,
  type PhaseProps,
} from './common'
import { DownloadsButton } from './Downloads'
import { OwnerField, ownerName } from './OwnerField'

// The stage's page heading when it says what to do, the same size in every phase.
const STAGE_TITLE = 'text-[32px] leading-tight font-extrabold tracking-tight'

/**
 * Wrap-up as the final board: Not discussed on the left, take-aways, the downloads, End session
 * and new actions on the stage, and every discussed topic with its actions on the right. The
 * downloads are in the toolbar too, as from the Vote reveal on. The ended board is the same,
 * read-only (spec F25, decision D61): no inputs, done boxes disabled, downloads kept.
 */
export default function WrapUp({ ctx, remaining }: PhaseProps) {
  const { board, state } = ctx
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
  const paused = state.paused_remaining_ms !== null
  const clock = state.phase_ends_at !== null || paused
  const totalMs = Math.max(state.settings.wrapup_s * 1000, remaining ?? 0)

  async function addAction(e: FormEvent) {
    e.preventDefault()
    if (
      newAction.trim() &&
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
      {/* The facilitator's clock buttons sit beside the ring, under the heading, so the take-aways
          and the downloads come up the share. */}
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
          {isFacilitator && clock && (
            <div className="mt-3">
              <TimerButtons ctx={ctx} />
            </div>
          )}
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
      <Takeaways ctx={ctx} onNote={onNote}>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DownloadButtons data={board.data} onNote={onNote} />
          {isFacilitator && (
            <Button
              variant="dangerOutline"
              className="h-12 sm:ml-auto"
              onClick={() => act('end_session', { p_board: state.board_id })}
            >
              End session
            </Button>
          )}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          Anyone in the session can download the files. Session data is deleted 7 days after the
          session ends.
        </p>
      </Takeaways>
      <div className="mt-6">
        <Eyebrow>New actions</Eyebrow>
        <form onSubmit={addAction} className="mt-2 flex flex-wrap gap-2">
          <input
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
          <Button type="submit" className="h-12">
            Add action
          </Button>
        </form>
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
  children,
}: {
  ctx: PhaseProps['ctx']
  onNote?: (message: string) => void
  readOnly?: boolean
  children?: ReactNode
}) {
  const { board, state, userId, act } = ctx
  const { takeaways, participants } = board.data
  const [text, setText] = useState('')
  const mine = takeaways.find((t) => t.user_id === userId)
  const shared = takeaways.filter((t) => !t.passed).length

  async function share(e: FormEvent) {
    e.preventDefault()
    if (text.trim() && (await act('set_takeaway', { p_board: state.board_id, p_text: text }))) {
      setText('')
      onNote('Your take-away is shared.')
    }
  }

  return (
    <div className="mt-6">
      <Eyebrow right={`${shared} of ${participants.length} shared`}>Take-aways</Eyebrow>
      {!readOnly && (
        <form onSubmit={share} className="mt-2 flex flex-wrap gap-2">
          <input
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
    </div>
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
          Every topic on the board was discussed.
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
                  {t.status === 'skipped' && ' · skipped'}
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
