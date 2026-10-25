/**
 * Daily keep-alive (build prompt 6.4). Supabase pauses free projects after a week without
 * activity; one trivial read a day prevents that. Scheduled functions run only on published
 * production deploys, in UTC, with a 30-second limit. GitHub Actions runs the same call as a backup
 * (.github/workflows/keepalive.yml).
 */
declare const process: { env: Record<string, string | undefined> }

export async function ping(
  url: string | undefined,
  key: string | undefined,
  fetcher = fetch,
): Promise<string> {
  if (!url || !key)
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set for functions')
  const res = await fetcher(`${url}/rest/v1/rpc/keepalive`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.text()
  if (!res.ok || body !== '"ok"')
    throw new Error(`keepalive failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  return body
}

export default async (): Promise<Response> => {
  try {
    await ping(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    console.log('keepalive ok')
    return new Response('ok')
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    return new Response('keepalive failed', { status: 502 })
  }
}

export const config = { schedule: '@daily' }
