import { useState, type FormEvent, type RefObject } from 'react'
import { ClockPanel } from '../../components/session/Clock'
import { PeopleButton } from '../../components/session/People'
import { Avatar, Button } from '../../components/ui'
import { download } from '../../lib/export/download'
import { boardTotals, cards, discussProgress, plural } from '../../lib/session'
import type { BoardData } from '../../state/useBoard'
import { useNow } from '../../state/useNow'
import { DiscussedColumn } from './BoardColumns'
import { Eyebrow, TimerButtons, type PhaseProps } from './common'
import { EndedDiscussedColumn } from './EndedColumns'
import { OwnerField, ownerName } from './OwnerField'
import {
  BoardFrame,
  CardActions,
  FILL_LEFT,
  FILL_RIGHT,
  SessionTime,
  SideColumn,
  STAGE,
  useLiveNote,
  useRefocus,
} from './VoteBoard'

/**
 * Wrap-up as the final board: Not discussed on the left, take-aways, new actions, the downloads
 * and End session on the stage, and every discussed topic with its actions on the right. The
 * ended board is the same, read-only (spec F25, decision D61): no inputs, done boxes disabled,
 * downloads kept.
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
      tools={<PeopleButton ctx={ctx} />}
      left={<NotDiscussedColumn ctx={ctx} totals={totals} readOnly={ended} />}
      stage={
        <section
          key="stage"
          ref={stageRef}
          aria-label={ended ? 'Session ended' : 'Wrap-up'}
          className={STAGE}
        >
          {ended ? (
            <EndedStage ctx={ctx} heading={headingRef} />
          ) : (
            <WrapUpStage ctx={ctx} remaining={remaining} heading={headingRef} onNote={setNote} />
          )}
        </section>
      }
      right={
        ended ? (
          <EndedDiscussedColumn ctx={ctx} totals={totals} className={FILL_RIGHT} />
        ) : (
          <DiscussedColumn ctx={ctx} totals={totals} onNote={setNote} className={FILL_RIGHT} />
        )
      }
      note={note}
    />
  )
}

/** The stage in Wrap-up: the soft clock, take-aways, new actions, downloads and End session. */
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
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 grow basis-72">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-[32px] leading-tight font-extrabold tracking-tight"
          >
            Nice work. Capture what you are taking away.
          </h1>
          <p className="mt-2 text-[16px] text-muted">One line each. Passing is fine.</p>
        </div>
        {clock && (
          <div className="w-[250px] shrink-0">
            <ClockPanel
              title="Wrap-up clock"
              remaining={remaining}
              totalMs={Math.max(state.settings.wrapup_s * 1000, remaining ?? 0)}
              paused={paused}
              note="A soft clock. The session ends when the facilitator ends it."
            />
          </div>
        )}
      </div>
      {isFacilitator && clock && (
        <div className="mt-3 flex">
          <TimerButtons ctx={ctx} />
        </div>
      )}
      <Takeaways ctx={ctx} onNote={onNote} />
      <div className="mt-6">
        <Eyebrow>New actions</Eyebrow>
        <form onSubmit={addAction} className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="New action"
            value={newAction}
            maxLength={140}
            onChange={(e) => setNewAction(e.target.value)}
            placeholder="Add an action"
            className="h-12 min-w-0 grow basis-60 rounded-xl border-2 border-line bg-panel px-3 text-[16px]"
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
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <DownloadButtons data={board.data} />
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
    </>
  )
}

/** The stage once the session has ended: the downloads and the take-aways, read-only. */
function EndedStage({
  ctx,
  heading,
}: {
  ctx: PhaseProps['ctx']
  heading: RefObject<HTMLHeadingElement | null>
}) {
  return (
    <>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[32px] leading-tight font-extrabold tracking-tight"
      >
        This session has ended
      </h1>
      <p className="mt-2 text-[16px] text-muted">
        The board is read-only. Download the results before it is deleted.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <DownloadButtons data={ctx.board.data} />
      </div>
      <p className="mt-2 text-[13px] text-muted">
        Anyone in the session can download the files. Session data is deleted 7 days after the
        session ended.
      </p>
      <Takeaways ctx={ctx} readOnly />
    </>
  )
}

/** Take-aways: one line each or a pass (spec section 3), and everyone's so far. */
function Takeaways({
  ctx,
  onNote = () => {},
  readOnly = false,
}: {
  ctx: PhaseProps['ctx']
  onNote?: (message: string) => void
  readOnly?: boolean
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
      {takeaways.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted">
          {readOnly ? 'No take-aways were shared.' : 'Nobody has shared one yet.'}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 @lg:grid-cols-2">
          {takeaways.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-xl bg-surface p-3 text-[15px] dark:bg-ground"
            >
              <Avatar name={t.author_name} />
              <span className="min-w-0 break-words">
                <b>{t.author_name}</b>{' '}
                {t.passed ? <span className="text-muted">Passed.</span> : t.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const FILES = [
  { kind: 'docx', label: 'Download Word file' },
  { kind: 'xlsx', label: 'Download Excel file' },
] as const

/** The Word and Excel files at hand, for everyone (spec F24), also once the session has ended. */
function DownloadButtons({ data }: { data: BoardData }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {FILES.map((f) => (
        <Button
          key={f.kind}
          className="h-12"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(f.kind)
            setError(null)
            try {
              await download(f.kind, data)
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
  return (
    <SideColumn label="Not discussed" className={FILL_LEFT}>
      <h2 className="flex justify-between px-1 text-[17px] font-bold">
        Not discussed <span className="text-muted">{left.length}</span>
      </h2>
      {left.length === 0 ? (
        <p className="mt-2 rounded-xl border-2 border-dashed border-line p-4 text-[15px] text-muted">
          Every topic on the board was discussed.
        </p>
      ) : (
        <>
          {/* Skipped is said in words and by a dashed edge, not by color alone. */}
          <ul className="mt-2 flex flex-col gap-2">
            {left.map((t) => (
              <li
                key={t.id}
                className={`rounded-xl border-2 bg-panel p-3 ${t.status === 'skipped' ? 'border-dashed border-line' : 'border-line-soft'}`}
              >
                <p className="text-[15px] leading-snug font-bold break-words">{t.text}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {t.author_name} · {plural(totals.get(t.id) ?? 0, 'vote')}
                  {t.status === 'skipped' && ' · skipped'}
                </p>
                <CardActions
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
