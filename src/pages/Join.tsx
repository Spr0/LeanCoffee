import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header'
import { Button, ErrorText, Eyebrow } from '../components/ui'
import { AppError, rpc } from '../lib/supabase'

export interface BoardInfo {
  name: string
  requires_passcode: boolean
  participant_count: number
  ended: boolean
  already_member: boolean
}

const NEXT = [
  'Write the topics you want to talk about. Others cannot see them yet.',
  'Vote with three dots. Counts stay hidden until everyone finishes.',
  'Discuss one topic at a time. When the clock ends, the group votes on whether to keep going.',
]

const inputClass =
  'mt-2 h-14 w-full rounded-xl border-2 border-line-strong bg-panel px-4 text-[18px] font-bold text-ink'

export default function Join({
  code,
  info,
  onJoined,
}: {
  code: string
  info: BoardInfo
  onJoined: (boardId: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await rpc<{ ok: boolean; board_id?: string; error?: string }>('join_board', {
        p_code: code,
        p_display_name: name,
        p_passcode: info.requires_passcode ? passcode : null,
      })
      if (!res.ok || !res.board_id) throw new AppError(res.error ?? 'network')
      await onJoined(res.board_id)
    } catch (err) {
      setError(err instanceof AppError ? err.message : 'Could not join. Try again.')
      setBusy(false)
    }
  }

  const count = info.participant_count
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-5 py-8">
        <Eyebrow>You are invited to</Eyebrow>
        <h1 className="mt-2 text-[30px] leading-tight font-extrabold">
          {info.name || 'A Lean Coffee session'}
        </h1>
        <p className="mt-2 flex items-center gap-2 text-[15px] text-muted">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-teal" />
          {count} {count === 1 ? 'person' : 'people'} here
        </p>

        {info.ended ? (
          <p className="mt-8 text-[17px] font-bold">This session has ended.</p>
        ) : (
          <form onSubmit={submit} className="mt-7">
            <label className="block text-[16px] font-bold">
              Name
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                required
                autoComplete="nickname"
              />
            </label>
            <p className="mt-2 text-[13px] text-muted">
              Up to 24 characters. This is the name others see on your topics.
            </p>
            {info.requires_passcode && (
              <label className="mt-5 block text-[16px] font-bold">
                Passcode
                <input
                  className={inputClass}
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
            )}
            <Button
              type="submit"
              className="mt-6 h-14 w-full text-[18px]"
              disabled={busy || !name.trim()}
            >
              {busy ? 'Joining…' : 'Join session'}
            </Button>
            <ErrorText message={error} />
          </form>
        )}

        <div className="mt-9">
          <Eyebrow>What happens next</Eyebrow>
          <ol className="mt-3 border-t border-line-soft">
            {NEXT.map((text, i) => (
              <li key={text} className="flex gap-4 border-b border-line-soft py-3.5 text-[15px]">
                <span className="font-bold text-teal">{i + 1}</span>
                {text}
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-auto pt-10 text-center text-[13px] text-muted">
          No account needed. Session data is deleted 7 days after the session ends.
        </p>
      </main>
    </div>
  )
}
