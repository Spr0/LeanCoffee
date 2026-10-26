import { useState } from 'react'
import type { BoardContext } from '../../pages/BoardView'
import { Button } from '../ui'
import { Dialog } from './Dialog'

export const inviteLink = (code: string) => `${window.location.origin}/b/${code}`

/** Plain text that reads well pasted into a chat or an email. */
export function inviteMessage(name: string, code: string, passcode: boolean): string {
  return [
    `Join our Lean Coffee${name ? `: ${name}` : ''}`,
    inviteLink(code),
    `Room code: ${code}`,
    ...(passcode ? ['Ask the facilitator for the passcode.'] : []),
  ].join('\n')
}

export function useCopy(): [string | null, (key: string, text: string) => void] {
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

/** Header button and dialog for sharing the board after the Lobby, for late joiners. */
export function InviteButton({ ctx }: { ctx: BoardContext }) {
  const { state, code } = ctx
  const [open, setOpen] = useState(false)
  const [copied, copy] = useCopy()
  const link = inviteLink(code)
  return (
    <>
      <span className="shrink-0 rounded-md bg-surface px-2 py-1 text-[13px] font-extrabold tracking-[0.08em] whitespace-nowrap text-ink dark:bg-line">
        <span className="sr-only">Room code: </span>
        {code}
      </span>
      {/* The name starts with the visible word (WCAG 2.5.3). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Invite people"
        className="min-h-11 shrink-0 rounded-lg border-2 border-line px-3 text-[15px] font-bold whitespace-nowrap text-teal hover:bg-surface dark:hover:bg-line"
      >
        Invite
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite people">
        <p className="mt-2 text-[15px] text-muted">
          Send the link in a chat or an email. People who join now can still add topics in the
          parking lot during Discuss.
        </p>
        {state.locked && (
          <p className="mt-3 rounded-xl border-2 border-urgent p-3 text-[15px] font-bold">
            The board is locked. Nobody new can join until the facilitator unlocks it.
          </p>
        )}
        <p className="mt-4 text-[13px] font-bold tracking-[0.12em] text-muted uppercase">
          Room code
        </p>
        <p className="text-[32px] font-extrabold tracking-[0.06em]">{code}</p>
        <input
          readOnly
          aria-label="Invite link"
          value={link}
          className="mt-3 h-12 w-full rounded-xl border-2 border-line-strong bg-panel px-3 text-[15px] text-muted"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              copy('message', inviteMessage(state.name, code, state.requires_passcode))
            }
          >
            {copied === 'message' ? 'Copied' : 'Copy invite message'}
          </Button>
          <Button onClick={() => copy('link', link)}>
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p className="sr-only" role="status">
          {copied ? 'Copied to the clipboard.' : ''}
        </p>
      </Dialog>
    </>
  )
}
