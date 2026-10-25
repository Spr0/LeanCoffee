import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './env'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

let pendingSession: Promise<string> | null = null

/** Every browser gets an anonymous Supabase identity; it persists across reloads. */
export function ensureSession(): Promise<string> {
  // Share one in-flight sign-in so concurrent callers never create two identities.
  pendingSession ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session.user.id
    const { data: signed, error } = await supabase.auth.signInAnonymously()
    if (error || !signed.user) throw new AppError('sign_in_failed')
    return signed.user.id
  })().finally(() => {
    pendingSession = null
  })
  return pendingSession
}

const MESSAGES: Record<string, string> = {
  sign_in_failed: 'Could not start a session. Check your connection and try again.',
  not_authenticated: 'Your session expired. Reload the page.',
  not_member: 'You are not part of this board.',
  not_facilitator: 'Only the facilitator can do that.',
  not_found: 'No board matches that code.',
  passcode_incorrect: 'That passcode is not right.',
  board_locked: 'The facilitator has locked this board to new people.',
  board_full: 'This board already has 12 people.',
  session_ended: 'This session has ended.',
  removed: 'The facilitator removed you from this board.',
  invalid_name: 'Names must be 1 to 24 characters.',
  invalid_passcode: 'Passcodes must be 6 to 64 characters.',
  rate_limited: 'You have created a lot of boards today. Try again tomorrow.',
  setting_locked: 'That setting cannot change once voting has started.',
  invalid_setting: 'That value is outside the allowed range.',
  invalid_phase_order: 'The session has already moved past that step.',
  wrong_phase: 'That is not available in this step.',
  topic_limit: 'You can add up to 5 topics.',
  topics_locked: 'The facilitator has closed topic submissions.',
  voting_closed: 'Voting is closed.',
  own_topic: 'Voting on your own topic is turned off.',
  dot_budget_exceeded: 'You have used all your dots.',
  cannot_remove_self: 'You cannot remove yourself.',
  cannot_remove_owner: 'The board creator cannot be removed.',
  not_owner: 'Only the board creator can take control back without the recovery link.',
  topic_unavailable: 'That topic has changed or is gone. Check the board.',
  topic_in_progress: 'That topic is being discussed. Move to the next topic first.',
  not_allowed: 'That is not allowed right now.',
  no_current_topic: 'There is no topic to extend.',
  timer_not_running: 'The clock is not running.',
  timer_not_paused: 'The clock is already running.',
  round_closed: 'That vote has closed.',
  network: 'Connection problem. Your last change may not have saved.',
}

export class AppError extends Error {
  readonly code: string
  constructor(code: string) {
    super(MESSAGES[code] ?? 'Something went wrong. Try again.')
    this.code = code
  }
}

/** Calls an RPC and turns database error codes into readable messages. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const code = /^[a-z_]+$/.test(error.message)
      ? error.message
      : error.code === '23514'
        ? 'invalid_setting'
        : 'network'
    throw new AppError(code)
  }
  return data as T
}
