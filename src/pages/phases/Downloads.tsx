import { useState } from 'react'
import { Dialog } from '../../components/session/Dialog'
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

/**
 * Word and Excel downloads for every member, from the Vote reveal onward (spec F24). Inside a
 * dialog the dialog's title names them, so `heading` is off.
 */
export default function Downloads({
  data,
  heading = true,
}: {
  data: BoardData
  heading?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      {heading && <h2 className="text-[20px] font-bold">Download the results</h2>}
      <p className="mt-1 text-[14px] text-muted">
        Files open in Word and Excel on Windows. Anyone in the session can download them.
      </p>
      <div className="mt-3 flex flex-col gap-3">
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

/** Discuss toolbar: the downloads, one click away in a dialog. */
export function DownloadsButton({ data }: { data: BoardData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" className="px-3" onClick={() => setOpen(true)}>
        Downloads
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Download the results">
        <div className="mt-2">
          <Downloads data={data} heading={false} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </Dialog>
    </>
  )
}
