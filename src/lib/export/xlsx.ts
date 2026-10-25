import ExcelJS from 'exceljs'
import type { ExportModel } from './model'
import { EXPORT_COLORS as C } from './palette'
import { cellText } from './sanitize'

/** `max` caps the column width in characters; longer text wraps. */
type Col = { header: string; key: string; kind: 'text' | 'number' | 'time'; max?: number }

const argb = (hex: string) => `FF${hex}`
const solid = (hex: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: argb(hex) },
})
const thin = { style: 'thin' as const, color: { argb: argb(C.rule) } }
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin }

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: Col[],
  rows: Record<string, string | number>[],
) {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    // Landscape, one page wide (any number of pages tall), header row repeated on every page.
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&CPage &P of &N' },
  })
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
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    const longest = Math.max(c.header.length, ...rows.map((r) => String(r[c.key] ?? '').length))
    col.width = Math.min(c.max ?? 50, Math.max(8, longest + 2))
    col.alignment = {
      wrapText: true,
      vertical: 'top',
      horizontal: c.kind === 'text' ? 'left' : 'center',
    }
    if (c.kind === 'time') col.numFmt = 'mm:ss'
  })
  // Header row: accent fill, bold on-accent text. Cell fills (not a row fill) so the colour stops
  // at the last column.
  const header = ws.getRow(1)
  header.font = { name: 'Calibri', size: 11, bold: true, color: { argb: argb(C.onAccent) } }
  for (let c = 1; c <= cols.length; c++) {
    const cell = header.getCell(c)
    cell.fill = solid(C.accent)
    cell.alignment = {
      wrapText: true,
      vertical: 'middle',
      horizontal: cols[c - 1]?.kind === 'text' ? 'left' : 'center',
    }
    cell.border = BORDER
  }
  // Body: light borders and banded rows (every second data row).
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= cols.length; c++) {
      const cell = row.getCell(c)
      cell.border = BORDER
      if (r % 2 === 1) cell.fill = solid(C.band)
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
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
      { header: 'Topic', key: 'text', kind: 'text', max: 50 },
      { header: 'Author', key: 'author', kind: 'text', max: 24 },
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
      { header: 'Action', key: 'text', kind: 'text', max: 50 },
      { header: 'Owner', key: 'owner', kind: 'text', max: 24 },
      { header: 'Topic', key: 'topic', kind: 'text', max: 40 },
      { header: 'Done', key: 'done', kind: 'text' },
    ],
    m.actions.map((a, i) => ({
      n: i + 1,
      text: a.text,
      owner: a.owner,
      topic: a.topic,
      done: a.done ? 'Yes' : 'No',
    })),
  )
  addSheet(
    wb,
    'Take-aways',
    [
      { header: 'Name', key: 'name', kind: 'text', max: 24 },
      { header: 'Take-away', key: 'text', kind: 'text', max: 80 },
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
