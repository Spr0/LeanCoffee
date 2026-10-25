import { expect, type Page } from '@playwright/test'

/**
 * Watches a page for security problems during a test (build prompt 7.5):
 * CSP violations, requests to any origin other than the app and Supabase, a Referer header on
 * requests that leave the app, and JavaScript dialogs (a sign that injected script ran).
 */
export function guard(page: Page) {
  const problems: string[] = []
  const app = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173').origin
  const supabase = new URL(process.env.VITE_SUPABASE_URL ?? 'http://invalid').origin
  page.on('console', (m) => {
    if (/Content.Security.Policy|Refused to (load|execute|connect|apply)/i.test(m.text()))
      problems.push(`CSP: ${m.text().slice(0, 200)}`)
  })
  page.on('dialog', (d) => {
    problems.push(`dialog opened: ${d.message()}`)
    void d.dismiss()
  })
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    if (
      url.origin !== app &&
      url.origin !== supabase.replace(/^http/, url.protocol.startsWith('ws') ? 'ws' : 'http')
    )
      problems.push(`request to unexpected origin: ${url.origin}`)
    if (url.origin !== app && r.headers()['referer']) problems.push(`Referer sent to ${url.origin}`)
  })
  return {
    problems,
    check: () => expect(problems, problems.join('\n')).toEqual([]),
  }
}
