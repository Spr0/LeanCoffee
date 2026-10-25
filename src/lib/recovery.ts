/** The recovery token is shown to the creator only; kept in this browser so it can be copied later. */
const key = (boardId: string) => `lean-coffee-recovery-${boardId}`

export function saveRecoveryToken(boardId: string, token: string): void {
  try {
    localStorage.setItem(key(boardId), token)
  } catch {
    // Without storage the creator can still reclaim from this browser while signed in.
  }
}

export function readRecoveryToken(boardId: string): string | null {
  try {
    return localStorage.getItem(key(boardId))
  } catch {
    return null
  }
}

/** Recovery links carry the token in the fragment, which browsers never send to a server. */
export function recoveryLink(code: string, token: string): string {
  return `${window.location.origin}/b/${code}#recover=${token}`
}

export function takeRecoveryTokenFromUrl(): string | null {
  const match = /^#recover=([A-Za-z0-9_-]{20,})$/.exec(window.location.hash)
  if (!match) return null
  window.history.replaceState(null, '', window.location.pathname)
  return match[1] ?? null
}
