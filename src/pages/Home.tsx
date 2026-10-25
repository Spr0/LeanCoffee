import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header'
import { Button, Card, ErrorText, Eyebrow } from '../components/ui'
import { formatCode, isValidCode, normalizeCode } from '../lib/code'
import { navigate } from '../lib/router'
import { AppError, ensureSession, rpc } from '../lib/supabase'
import { saveRecoveryToken } from '../lib/recovery'

const STEPS = [
  ['Brainstorm', 'Everyone adds topics privately', '5:00'],
  ['Clarify', 'Topics appear together, with a short pitch for each', '30 s each'],
  ['Vote', 'Three dots each, counts hidden until everyone finishes', '1:30'],
  ['Discuss', 'One shared clock, then the group votes to continue or move on', '5:00 + 3:00'],
  ['Wrap-up', 'Take-aways, actions, and Word and Excel downloads', '5:00'],
] as const

const LENGTHS = [45, 60, 75, 90]

const inputClass =
  'mt-2 h-[52px] w-full rounded-xl border-2 border-line bg-panel px-4 text-[16px] text-ink placeholder:text-muted'

export default function Home() {
  const [name, setName] = useState('')
  const [boardName, setBoardName] = useState('')
  const [minutes, setMinutes] = useState(75)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await ensureSession()
      const made = await rpc<{ board_id: string; code: string; recovery_token: string }>(
        'create_board',
        {
          p_display_name: name,
          p_name: boardName,
        },
      )
      saveRecoveryToken(made.board_id, made.recovery_token)
      if (minutes !== 75) {
        await rpc('update_settings', { p_board: made.board_id, p_planned_minutes: minutes })
      }
      navigate(`/b/${formatCode(made.code)}`)
    } catch (err) {
      setError(err instanceof AppError ? err.message : 'Could not create the board. Try again.')
      setBusy(false)
    }
  }

  function join(e: FormEvent) {
    e.preventDefault()
    if (!isValidCode(code)) {
      setCodeError('Room codes are 8 letters and numbers, like KQ74-M2X9.')
      return
    }
    navigate(`/b/${formatCode(normalizeCode(code))}`)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 py-10 sm:px-10 lg:grid-cols-[1fr_480px] lg:gap-24 lg:py-14">
        <section>
          <h1 className="text-[40px] leading-tight font-extrabold tracking-tight sm:text-[56px]">
            Run a Lean Coffee session
          </h1>
          <p className="mt-4 max-w-[620px] text-[19px] text-muted">
            No sign-up. Share the link in Teams, build the agenda together, then download the
            results as Word and Excel files.
          </p>
          <div className="mt-10">
            <Eyebrow>How a session runs</Eyebrow>
            <ol className="mt-3 border-t border-line-soft">
              {STEPS.map(([title, detail, time], i) => (
                <li key={title} className="flex items-center gap-4 border-b border-line-soft py-4">
                  <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-teal-soft text-[15px] font-bold text-teal">
                    {i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[17px] font-bold">{title}</span>
                    <span className="block text-[14px] text-muted">{detail}</span>
                  </span>
                  <span className="text-[15px] font-bold text-teal">{time}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <Card>
            <form onSubmit={create}>
              <h2 className="text-[22px] font-bold">Start a session</h2>
              <label className="mt-5 block text-[14px] font-bold">
                Your name
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  required
                  autoComplete="nickname"
                  placeholder="Priya"
                />
              </label>
              <label className="mt-4 block text-[14px] font-bold">
                Board name <span className="font-medium text-muted">(optional)</span>
                <input
                  className={inputClass}
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  maxLength={60}
                  placeholder="Product team sync"
                />
              </label>
              <fieldset className="mt-5">
                <legend className="text-[14px] font-bold">Planned length</legend>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {LENGTHS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={minutes === m}
                      onClick={() => setMinutes(m)}
                      className={`h-12 rounded-xl border-2 text-[15px] font-bold ${minutes === m ? 'border-teal bg-teal-soft text-teal' : 'border-line bg-panel'}`}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[13px] text-muted">
                  75 minutes is the recommended length. You can change every timer in the lobby.
                </p>
              </fieldset>
              <Button
                type="submit"
                className="mt-5 h-14 w-full text-[17px]"
                disabled={busy || !name.trim()}
              >
                {busy ? 'Creating…' : 'Create board'}
              </Button>
              <ErrorText message={error} />
              <p className="mt-5 text-[13px] text-muted">
                You run the session and can hand control to anyone. Session data is deleted 7 days
                after the session ends.
              </p>
            </form>
          </Card>
          <div className="rounded-2xl border border-line-soft p-7">
            <form onSubmit={join}>
              <label htmlFor="room-code" className="text-[17px] font-bold">
                Have a room code?
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  id="room-code"
                  className="h-[52px] min-w-0 flex-1 rounded-xl border-2 border-line bg-panel px-4 text-[17px] font-bold tracking-[0.08em] uppercase placeholder:text-muted"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setCodeError(null)
                  }}
                  placeholder="KQ74-M2X9"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" variant="secondary" className="h-[52px]">
                  Join
                </Button>
              </div>
              <ErrorText message={codeError} />
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}
