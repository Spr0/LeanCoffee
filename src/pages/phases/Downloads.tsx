import { useState } from 'react'
import { Button } from '../../components/ui'
import { download, previewName } from '../../lib/export/download'
import type { BoardData } from '../../state/useBoard'

const FILES = [
  {
    kind: 'docx',
    title: 'Word summary (.docx)',
    detail: 'Topics discussed with votes, take-aways, and actions with owners',
    label: 'Download Word file',
  },
  {
    kind: 'xlsx',
    title: 'Excel workbook (.xlsx)',
    detail: 'Three sheets: Topics and votes, Actions, Take-aways',
    label: 'Download Excel file',
  },
] as const

/** Word and Excel downloads for every member, from the Vote reveal onward (spec F24). */
export default function Downloads({ data, wide = false }: { data: BoardData; wide?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <h2 className="text-[20px] font-bold">Download the results</h2>
      <p className="mt-1 text-[14px] text-muted">
        Files open in Word and Excel on Windows. Anyone in the session can download them.
      </p>
      {/* Wide places (the Board tab) show the two files side by side. */}
      <div className={`mt-3 gap-3 ${wide ? 'grid md:grid-cols-2' : 'flex flex-col'}`}>
        {FILES.map((f) => (
          <div key={f.kind} className="rounded-xl border border-line-soft bg-panel p-4">
            <p className="text-[16px] font-bold">{f.title}</p>
            <p className="text-[14px] text-muted">{f.detail}</p>
            <p className="mt-1 text-[13px] text-muted">{previewName(data, f.kind)}</p>
            <Button
              className="mt-3 w-full"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(f.kind)
                setError(null)
                try {
                  await download(f.kind, data)
                } catch {
                  setError('Could not build the file. Try again.')
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === f.kind ? 'Preparing…' : f.label}
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[14px] font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
