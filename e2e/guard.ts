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
  const allowed = (origin: string) =>
    origin === app || origin === supabase || origin === supabase.replace(/^http/, 'ws')
  page.on('request', async (r) => {
    const url = new URL(r.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    if (!allowed(url.origin)) problems.push(`request to unexpected origin: ${url.origin}`)
    // allHeaders() includes the Referer, which headers() may omit.
    const headers = await r.allHeaders().catch(() => ({}) as Record<string, string>)
    if (url.origin !== app && headers['referer']) problems.push(`Referer sent to ${url.origin}`)
  })
  // WebSockets do not raise request events; check them separately.
  page.on('websocket', (ws) => {
    const origin = new URL(ws.url()).origin
    if (!allowed(origin)) problems.push(`websocket to unexpected origin: ${origin}`)
  })
  return {
    problems,
    check: () => expect(problems, problems.join('\n')).toEqual([]),
  }
}
