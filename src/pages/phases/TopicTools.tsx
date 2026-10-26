import { useEffect, useId, useRef, useState } from 'react'
import { Dialog } from '../../components/session/Dialog'
import { Button } from '../../components/ui'
import { mergedInto } from '../../lib/session'
import type { Topic } from '../../lib/types'
import type { PhaseProps } from './common'

export const TOPIC_MAX = 160

/**
 * Facilitator's inline topic edit: Enter or Save saves; Cancel or Escape cancels. `large` is the
 * stage's editor, which takes the place of the 44 px heading.
 */
export function TopicEditor({
  ctx,
  topic,
  onDone,
  large = false,
}: {
  ctx: PhaseProps['ctx']
  topic: Topic
  onDone: () => void
  large?: boolean
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
        dir="auto"
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
        className={`w-full min-w-0 resize-none rounded-lg border-2 border-teal bg-panel p-2.5 ${large ? 'text-[20px] leading-snug' : 'text-[15px]'}`}
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
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="secondary"
      className={`px-3 ${className}`}
      aria-label={`Bring back "${topic.text}"`}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const ok = await ctx.act('restore_topic', { p_topic: topic.id })
        setBusy(false)
        if (ok) onBack(`"${topic.text}" is back at the end of the queue.`)
      }}
    >
      Bring back
    </Button>
  )
}

/**
 * Confirms a facilitator's topic delete. Cards merged into it go too: left behind they would
 * return to the queue unranked. Closes itself if the topic goes on stage or the role moves.
 */
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
  const [busy, setBusy] = useState(false)
  const topics = ctx.board.data.topics
  const live = topic ? topics.find((t) => t.id === topic.id) : undefined
  const usable = live !== undefined && live.status !== 'discussing' && ctx.isFacilitator
  const merged = live ? mergedInto(topics, live.id) : []
  useEffect(() => {
    if (topic && !usable && !busy) onClose()
  }, [topic, usable, busy, onClose])

  async function remove() {
    if (!live) return
    setBusy(true)
    let ok = true
    for (const t of [...merged, live]) {
      ok = await ctx.act('delete_topic', { p_topic: t.id })
      if (!ok) break
    }
    setBusy(false)
    if (ok) {
      onClose()
      onDeleted(`"${live.text}" was deleted.`)
    }
  }

  return (
    <Dialog open={topic !== null && usable} onClose={onClose} title="Delete this topic?">
      <p dir="auto" className="mt-3 text-[17px] font-bold break-words [overflow-wrap:anywhere]">
        {live?.text}
      </p>
      <p className="mt-2 text-[15px] text-muted">
        It is removed for everyone, along with its votes. Actions from it stay.
        {merged.length > 0 &&
          ` ${merged.length === 1 ? 'The card' : `The ${merged.length} cards`} merged into it ${merged.length === 1 ? 'goes' : 'go'} too.`}
        {merged.length > 0 &&
          ctx.state.phase === 'clarify' &&
          ' Undo the merge first to keep them.'}
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={remove}>
          Delete topic
        </Button>
      </div>
    </Dialog>
  )
}
