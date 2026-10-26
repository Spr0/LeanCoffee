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
    name: 'Word file',
  },
  {
    kind: 'xlsx',
    title: 'Excel workbook (.xlsx)',
    detail: 'Three sheets: Topics and votes, Actions, Take-aways',
    label: 'Download Excel file',
    name: 'Excel file',
  },
] as const

/**
 * Word and Excel downloads for every member, from the Vote reveal onward (spec F24). Inside a
 * dialog the dialog's title names them, so `heading` is off. While a file is built the buttons say
 * so but stay enabled (aria-disabled), so the pressed one keeps keyboard focus, and a polite line
 * says when the file is ready.
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
  const [said, setSaid] = useState('')
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
              className="mt-3 w-full aria-disabled:cursor-progress aria-disabled:opacity-50"
              aria-disabled={busy !== null || undefined}
              onClick={async () => {
                if (busy !== null) return
                setBusy(f.kind)
                setError(null)
                setSaid(`Preparing the ${f.name}…`)
                try {
                  await download(f.kind, data)
                  setSaid(`${f.name} downloaded.`)
                } catch {
                  setSaid('')
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
      <p role="status" className="sr-only">
        {said}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[14px] font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** The toolbar's Downloads, from the Vote reveal on: the files one click away in a dialog. */
export function DownloadsButton({ data }: { data: BoardData }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" className="px-3" aria-haspopup="dialog" onClick={() => setOpen(true)}>
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
