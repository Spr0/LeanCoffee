// @vitest-environment node
import { ping } from './keepalive.mts'

const ok = async () => new Response('"ok"', { status: 200 })

describe('keepalive', () => {
  it('posts to the keepalive RPC with the publishable key', async () => {
    const calls: [string, RequestInit][] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return ok()
    }) as typeof fetch
    await expect(ping('https://x.supabase.co', 'sb_publishable_k', fetcher)).resolves.toBe('"ok"')
    expect(calls[0]?.[0]).toBe('https://x.supabase.co/rest/v1/rpc/keepalive')
    expect((calls[0]?.[1].headers as Record<string, string>).apikey).toBe('sb_publishable_k')
  })
  it('fails loudly on a paused or broken project', async () => {
    const paused = (async () =>
      new Response('{"message":"paused"}', { status: 540 })) as typeof fetch
    await expect(ping('https://x.supabase.co', 'k', paused)).rejects.toThrow('HTTP 540')
  })
  it('refuses to run without configuration', async () => {
    await expect(ping(undefined, 'k')).rejects.toThrow('must be set')
  })
})
