import { useEffect, useRef } from 'react'
import type { Phase } from '../lib/types'

/**
 * A phase change replaces the main content, so the control that moved the board on (Start
 * brainstorm, End brainstorm now, Skip pitches, Start discussing, Start wrap-up) goes with it.
 * If focus was in the main content and is left on the page itself, it moves to the new page
 * heading rather than to the top of the page. A phase that moves focus itself has done so first.
 */
export function usePhaseFocus(phase: Phase | undefined) {
  const inMain = useRef(false)
  useEffect(() => {
    const track = (e: FocusEvent) => {
      inMain.current = e.target instanceof Element && e.target.closest('main') !== null
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [])
  useEffect(() => {
    const active = document.activeElement
    if (inMain.current && (active === null || active === document.body))
      document.querySelector<HTMLElement>('main h1')?.focus()
  }, [phase])
}
