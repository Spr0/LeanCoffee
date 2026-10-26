import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'

/*
 * A modal dialog makes the rest of the page inert, so the board's live line, the timer's
 * announcements and the error banner are not heard (or seen) while one is open. The board echoes
 * them here, and an open dialog repeats what arrives after it opened.
 */
interface Echo {
  status: string
  statusN: number
  error: string | null
  errorN: number
}
let echo: Echo = { status: '', statusN: 0, error: null, errorN: 0 }
const listeners = new Set<() => void>()
const publish = (next: Partial<Echo>) => {
  echo = { ...echo, ...next }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => echo

/** Repeats a polite announcement in any open dialog. */
export function echoStatus(text: string) {
  if (text) publish({ status: text, statusN: echo.statusN + 1 })
}

/** Shows the board's error (or clears it) in any open dialog. */
export function echoError(text: string | null) {
  if (text !== echo.error) publish({ error: text, errorN: echo.errorN + 1 })
}

/** Mounted with the open dialog, so its live region is there before any text arrives. */
function DialogEcho() {
  const [opened] = useState(snapshot)
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  const status = now.statusN > opened.statusN ? now.status : ''
  const error = now.errorN > opened.errorN ? now.error : null
  return (
    <>
      <p role="status" className="sr-only">
        <span key={now.statusN}>{status}</span>
      </p>
      {error && (
        <p role="alert" className="mt-4 text-[15px] font-bold text-danger">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Native modal dialog, its content mounted only while it is open. Focus moves to its title, so it
 * opens at the top and no button is pressed by a second Enter; Escape closes it, and focus returns
 * to the opener.
 */
export function Dialog({
  open,
  onClose,
  title,
  titleRef,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** For a dialog that moves focus back to its title, as after removing someone from a list. */
  titleRef?: RefObject<HTMLHeadingElement | null>
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const ownTitle = useRef<HTMLHeadingElement>(null)
  const heading = titleRef ?? ownTitle
  const titleId = useId()
  // Before paint, so a closing dialog never shows for a frame with its content gone.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      heading.current?.focus()
    }
    if (!open && d.open) d.close()
  }, [open, heading])
  return (
    <dialog
      ref={ref}
      // React bubbles "close" through the tree, so a dialog opened inside this one (the people
      // dialog's handover and end-session dialogs) would close it too. Only its own close counts.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-2xl bg-panel p-8 text-ink backdrop:bg-black/50 dark:ring-2 dark:ring-line-strong dark:backdrop:bg-black/70"
    >
      <h2
        id={titleId}
        ref={heading}
        tabIndex={-1}
        className="text-[26px] font-extrabold focus:outline-none"
      >
        {title}
      </h2>
      {/* A closed dialog holds nothing, so a participant's page has no facilitator controls. */}
      {open && (
        <>
          {children}
          <DialogEcho />
        </>
      )}
    </dialog>
  )
}
