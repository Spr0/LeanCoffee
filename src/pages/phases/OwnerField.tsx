import { useId } from 'react'
import type { Participant } from '../../lib/types'

/** Action owner: a participant (suggested from the list) or any name (spec F22). */
export function OwnerField({
  value,
  onChange,
  people,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  people: Participant[]
  className?: string
}) {
  const listId = useId()
  return (
    <>
      <input
        aria-label="Action owner"
        list={listId}
        value={value}
        maxLength={24}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Owner (optional)"
        autoComplete="off"
        className={`w-44 min-w-0 border-2 border-line bg-panel px-3 text-[15px] ${className}`}
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
