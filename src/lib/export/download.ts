import type { BoardData } from '../../state/useBoard'
import { rpc } from '../supabase'
import { measureOffset } from '../time'
import { buildModel } from './model'
import { exportFilename } from './sanitize'

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const SERVER_TIME_WAIT_MS = 3_000

/**
 * The server's clock, measured as the board measures it, so a file made on a computer whose clock
 * is off still gives the session length the toolbar shows. Falls back to this computer's clock
 * when the server does not answer in time.
 */
export async function serverNow(): Promise<Date> {
  const sent = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const server = await Promise.race([
      rpc<string>('server_time'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), SERVER_TIME_WAIT_MS)
      }),
    ])
    const serverMs = Date.parse(server)
    if (!Number.isFinite(serverMs)) return new Date()
    const received = Date.now()
    return new Date(received + measureOffset(serverMs, sent, received))
  } catch {
    return new Date()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Builds and downloads the file. The generators load on first use to keep the first page small.
 * `now` is the server-corrected time; without it the server's clock is measured first, unless the
 * session has ended and the file no longer depends on the time.
 */
export async function download(kind: 'docx' | 'xlsx', data: BoardData, now?: Date): Promise<void> {
  const at = now ?? (data.state?.ended_at ? new Date() : await serverNow())
  const model = buildModel(data, at)
  const blob =
    kind === 'docx'
      ? await (await import('./docx')).buildDocx(model)
      : await (await import('./xlsx')).buildXlsx(model)
  save(blob, exportFilename(model.title, model.date, kind))
}

/** The file name the download will have: it depends only on the board's name and start day. */
export function previewName(data: BoardData, kind: 'docx' | 'xlsx', now = new Date()): string {
  const model = buildModel(data, now)
  return exportFilename(model.title, model.date, kind)
}
