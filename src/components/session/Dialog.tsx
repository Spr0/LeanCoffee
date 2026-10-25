import { useEffect, useId, useRef, type ReactNode } from 'react'

/** Native modal dialog: focus moves in, Escape closes, focus returns to the opener. */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-2xl bg-panel p-8 text-ink backdrop:bg-black/50"
    >
      <h2 id={titleId} className="text-[26px] font-extrabold">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
