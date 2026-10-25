import { useEffect, useId, useRef, useState } from 'react'
import { Dialog } from '../../components/session/Dialog'
import { Button } from '../../components/ui'
import type { Topic } from '../../lib/types'
import type { PhaseProps } from './common'

export const TOPIC_MAX = 160

/** Facilitator's inline topic edit: Enter or Save saves; Cancel or Escape cancels. */
export function TopicEditor({
  ctx,
  topic,
  onDone,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  onDone: () => void
}) {
  const [text, setText] = useState(topic.text)
  const input = useRef<HTMLTextAreaElement>(null)
  const countId = useId()
  useEffect(() => {
    input.current?.focus()
  }, [])
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        const value = text.trim()
        if (!value) return
        if (
          value === topic.text ||
          (await ctx.act('edit_topic', { p_topic: topic.id, p_text: value }))
        )
          onDone()
      }}
    >
      {/* Several rows so a long topic fits a narrow column; Enter saves, as topics are one line. */}
      <textarea
        ref={input}
        aria-label="Edit topic"
        aria-describedby={countId}
        value={text}
        rows={3}
        maxLength={TOPIC_MAX}
        onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
          }
        }}
        className="w-full min-w-0 resize-none rounded-lg border-2 border-teal bg-panel p-2.5 text-[15px]"
      />
      <p id={countId} className="text-[13px] text-muted">
        {text.length} of {TOPIC_MAX} characters
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="submit" className="px-3" disabled={!text.trim()}>
          Save
        </Button>
        <Button variant="ghost" className="px-3" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Facilitator: return a skipped topic to the bottom of the queue (spec F20). */
export function BringBack({
  ctx,
  topic,
  onBack,
  className = '',
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  onBack: (message: string) => void
  className?: string
}) {
  return (
    <Button
      variant="secondary"
      className={`px-3 ${className}`}
      aria-label={`Bring back "${topic.text}"`}
      onClick={async () => {
        if (await ctx.act('restore_topic', { p_topic: topic.id }))
          onBack(`"${topic.text}" is back at the end of the queue.`)
      }}
    >
      Bring back
    </Button>
  )
}

/** Confirms a facilitator's topic delete. */
export function DeleteTopicDialog({
  ctx,
  topic,
  onClose,
  onDeleted,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic | null
  onClose: () => void
  onDeleted: (message: string) => void
}) {
  return (
    <Dialog open={topic !== null} onClose={onClose} title="Delete this topic?">
      <p className="mt-3 text-[17px] font-bold break-words">{topic?.text}</p>
      <p className="mt-2 text-[15px] text-muted">
        It is removed for everyone, along with its votes. Actions from it stay.
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="ghost"
          className="border-danger text-danger"
          onClick={async () => {
            if (topic && (await ctx.act('delete_topic', { p_topic: topic.id }))) {
              onClose()
              onDeleted(`"${topic.text}" was deleted.`)
            }
          }}
        >
          Delete topic
        </Button>
      </div>
    </Dialog>
  )
}
