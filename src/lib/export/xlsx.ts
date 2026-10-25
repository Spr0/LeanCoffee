import ExcelJS from 'exceljs'
import type { ExportModel } from './model'
import { cellText } from './sanitize'

type Col = { header: string; key: string; kind: 'text' | 'number' | 'time' }

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: Col[],
  rows: Record<string, string | number>[],
) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key }))
  for (const r of rows) {
    const values: Record<string, string | number> = {}
    for (const c of cols) {
      const v = r[c.key] ?? ''
      // Text always goes through the injection guard; numbers stay numeric.
      values[c.key] =
        c.kind === 'text'
          ? cellText(String(v))
          : c.kind === 'time'
            ? Number(v) / 86_400_000
            : Number(v)
    }
    ws.addRow(values)
  }
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    const longest = Math.max(c.header.length, ...rows.map((r) => String(r[c.key] ?? '').length))
    col.width = Math.min(60, Math.max(8, longest + 2))
    col.alignment = { wrapText: true, vertical: 'top' }
    if (c.kind === 'time') col.numFmt = 'mm:ss'
  })
  return ws
}

/** Excel workbook: Topics, Actions and Take-aways sheets. */
export function buildWorkbook(m: ExportModel): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lean Coffee'
  wb.title = m.title
  addSheet(
    wb,
    'Topics',
    [
      { header: 'Rank', key: 'rank', kind: 'number' },
      { header: 'Topic', key: 'text', kind: 'text' },
      { header: 'Author', key: 'author', kind: 'text' },
      { header: 'Votes', key: 'votes', kind: 'number' },
      { header: 'Status', key: 'status', kind: 'text' },
      { header: 'Time spent', key: 'time', kind: 'time' },
      { header: 'Extensions', key: 'extensions', kind: 'number' },
    ],
    m.all.map((x) => ({ ...x, time: x.timeSpentMs })),
  )
  addSheet(
    wb,
    'Actions',
    [
      { header: '#', key: 'n', kind: 'number' },
      { header: 'Action', key: 'text', kind: 'text' },
      { header: 'Owner', key: 'owner', kind: 'text' },
      { header: 'Topic', key: 'topic', kind: 'text' },
    ],
    m.actions.map((a, i) => ({ n: i + 1, ...a })),
  )
  addSheet(
    wb,
    'Take-aways',
    [
      { header: 'Name', key: 'name', kind: 'text' },
      { header: 'Take-away', key: 'text', kind: 'text' },
    ],
    m.takeaways,
  )
  return wb
}

export async function buildXlsx(m: ExportModel): Promise<Blob> {
  const buffer = await buildWorkbook(m).xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
