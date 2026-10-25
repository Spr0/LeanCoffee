import type { BoardData } from '../../state/useBoard'
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

/** Builds and downloads the file. The generators load on first use to keep the first page small. */
export async function download(
  kind: 'docx' | 'xlsx',
  data: BoardData,
  now = new Date(),
): Promise<void> {
  const model = buildModel(data, now)
  const blob =
    kind === 'docx'
      ? await (await import('./docx')).buildDocx(model)
      : await (await import('./xlsx')).buildXlsx(model)
  save(blob, exportFilename(model.title, model.date, kind))
}

export function previewName(data: BoardData, kind: 'docx' | 'xlsx', now = new Date()): string {
  const model = buildModel(data, now)
  return exportFilename(model.title, model.date, kind)
}
