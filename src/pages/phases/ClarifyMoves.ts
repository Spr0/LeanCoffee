import type { Topic } from '../../lib/types'

/** Clarify as one announcement compares it: the cards and the card being pitched. */
export interface ClarifyMoment {
  topics: Topic[]
  pitch: string | null
}

/**
 * One polite announcement for what changed between two snapshots of the Clarify board: a merge,
 * an undone merge, a deleted card, or the next pitch. Cards carried along when their card is
 * merged, or deleted with it, are not named one by one.
 */
export function clarifyMoves(before: ClarifyMoment, after: ClarifyMoment): string {
  const was = new Map(before.topics.map((t) => [t.id, t]))
  const now = new Map(after.topics.map((t) => [t.id, t]))
  const said: string[] = []
  for (const t of after.topics) {
    const old = was.get(t.id)
    if (!old || old.merged_into === t.merged_into) continue
    if (old.merged_into === null && t.merged_into !== null) {
      const into = now.get(t.merged_into)
      said.push(`"${t.text}" was merged into ${into ? `"${into.text}"` : 'another card'}.`)
    } else if (t.merged_into === null) {
      said.push(`"${t.text}" is a card of its own again.`)
    }
  }
  for (const t of before.topics)
    if (!now.has(t.id) && t.merged_into === null) said.push(`"${t.text}" was deleted.`)
  if (after.pitch !== before.pitch) {
    const pitched = after.pitch ? now.get(after.pitch) : undefined
    if (pitched) said.push(`${pitched.author_name} is pitching "${pitched.text}".`)
    else if (after.pitch === null) said.push('Pitches stopped.')
  }
  return said.join(' ')
}
