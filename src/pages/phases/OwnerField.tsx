import { useId, type FocusEventHandler, type RefObject } from 'react'
import type { Participant } from '../../lib/types'

/** Action owner: a participant (suggested from the list) or any name (spec F22). */
export function OwnerField({
  value,
  onChange,
  people,
  className = '',
  inputRef,
  onFocus,
  onBlur,
}: {
  value: string
  onChange: (v: string) => void
  people: Participant[]
  className?: string
  inputRef?: RefObject<HTMLInputElement | null>
  onFocus?: FocusEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
}) {
  const listId = useId()
  return (
    <>
      <input
        ref={inputRef}
        aria-label="Action owner"
        list={listId}
        value={value}
        maxLength={24}
        dir="auto"
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Owner (optional)"
        autoComplete="off"
        className={`w-44 min-w-0 border-2 border-line-strong bg-panel px-3 text-[15px] ${className}`}
      />
      <datalist id={listId}>
        {people.map((p) => (
          <option key={p.id} value={p.display_name} />
        ))}
      </datalist>
    </>
  )
}

/** Owner name to send: null when blank. */
export const ownerName = (v: string): string | null => v.trim() || null
