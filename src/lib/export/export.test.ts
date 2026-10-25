// @vitest-environment node
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { Packer } from 'docx'
import type { BoardData } from '../../state/useBoard'
import type { BoardState, Topic } from '../types'
import { buildDocument } from './docx'
import { buildModel } from './model'
import { cellText, exportFilename, xmlSafe } from './sanitize'
import { buildWorkbook } from './xlsx'

const INJECTIONS = [
  '=HYPERLINK("http://example.com","x")',
  '+1+1',
  '@SUM(1+1)',
  '-2+3',
  "=cmd|' /C calc'!A0",
  '\tTAB',
  '\rCR',
]

describe('filenames', () => {
  const day = new Date('2026-10-24T15:00:00Z')
  it('uses the board name and date', () => {
    expect(exportFilename('Product team sync', day, 'docx')).toBe(
      'Product team sync 2026-10-24.docx',
    )
  })
  it('replaces characters Windows forbids', () => {
    expect(exportFilename('Q3: plan <draft> "v2" a/b\\c|d?e*', day, 'xlsx')).toBe(
      'Q3 plan draft v2 a b c d e 2026-10-24.xlsx',
    )
  })
  it('drops trailing dots and spaces', () => {
    expect(exportFilename('Retro... ', day, 'docx')).toBe('Retro 2026-10-24.docx')
  })
  it.each(['CON', 'prn', 'Aux', 'NUL', 'COM1', 'LPT9', '', '   ', '...'])(
    'falls back for "%s"',
    (name) => {
      expect(exportFilename(name, day, 'docx')).toBe('Lean Coffee 2026-10-24.docx')
    },
  )
  it('caps the length at 100 characters', () => {
    const name = exportFilename('x'.repeat(300), day, 'xlsx')
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith('.xlsx')).toBe(true)
  })
})

describe('text safety', () => {
  it.each(INJECTIONS)('prefixes an apostrophe to %j', (payload) => {
    expect(cellText(payload).startsWith("'")).toBe(true)
  })
  it('leaves ordinary text alone', () => {
    expect(cellText('Retro cadence')).toBe('Retro cadence')
  })
  it('strips characters XML 1.0 forbids but keeps emoji and accents', () => {
    expect(
      xmlSafe(
        `a${String.fromCharCode(0)}b${String.fromCharCode(0xb)}c${String.fromCharCode(0xfffe)} café 🚀`,
      ),
    ).toBe('abc café 🚀')
  })
})

function topic(id: string, text: string, author: string, extra: Partial<Topic> = {}): Topic {
  return {
    id,
    board_id: 'b',
    author_user_id: author,
    author_name: author,
    text,
    status: 'open',
    merged_into: null,
    sort_order: 0,
    time_spent_ms: 0,
    extensions: 0,
    discussed_seq: null,
    created_at: '',
    ...extra,
  }
}

const XSS = '<img src=x onerror=alert(1)>'
function sample(): BoardData {
  const state = {
    board_id: 'b',
    name: 'Product team sync',
    base_round: 0,
    started_at: '2026-10-24T15:00:00Z',
    ended_at: '2026-10-24T16:11:00Z',
    planned_minutes: 75,
  } as BoardState
  return {
    state,
    participants: ['Ana', 'Dev', 'Maya'].map((n, i) => ({
      id: `p${i}`,
      board_id: 'b',
      user_id: n,
      display_name: n,
      joined_at: '',
      last_seen_at: '',
      finished_voting: false,
    })),
    topics: [
      topic('t1', 'How do we onboard remote hires?', 'Maya', {
        status: 'discussed',
        discussed_seq: 1,
        time_spent_ms: 480_000,
        extensions: 1,
      }),
      topic('t2', INJECTIONS[0] ?? '', 'Dev', {
        status: 'discussed',
        discussed_seq: 2,
        time_spent_ms: 300_000,
      }),
      topic('t3', XSS, 'Ana', { sort_order: 3 }),
      topic('t4', 'Async updates nobody reads', 'Dev', { merged_into: 't1' }),
    ],
    votes: [
      { id: 'v1', board_id: 'b', topic_id: 't1', user_id: 'Ana', round: 0, dots: 3 },
      { id: 'v2', board_id: 'b', topic_id: 't3', user_id: 'Dev', round: 0, dots: 2 },
    ],
    extendRounds: [],
    extendVotes: [],
    actions: [
      {
        id: 'a1',
        board_id: 'b',
        topic_id: 't1',
        text: '+1 for buddy system',
        owner_name: 'Maya',
        created_by: 'x',
        done: false,
        created_at: '1',
      },
    ],
    takeaways: [
      {
        id: 'k1',
        board_id: 'b',
        user_id: 'Ana',
        author_name: 'Ana',
        text: '@everyone read the doc',
        passed: false,
      },
      { id: 'k2', board_id: 'b', user_id: 'Dev', author_name: 'Dev', text: null, passed: true },
    ],
  }
}

describe('export model', () => {
  const m = buildModel(sample(), new Date('2026-10-24T16:30:00Z'))
  it('orders discussed topics by discussion order and the rest by votes', () => {
    expect(m.discussed.map((d) => d.rank)).toEqual([1, 2])
    expect(m.discussed[0]?.text).toBe(
      'How do we onboard remote hires? / Async updates nobody reads',
    )
    expect(m.discussed[0]?.author).toBe('Maya, Dev')
    expect(m.notDiscussed[0]?.votes).toBe(2)
  })
  it('measures minutes from start to end and counts people', () => {
    expect(m.minutes).toBe(71)
    expect(m.people).toBe(3)
  })
  it('omits passed take-aways', () => {
    expect(m.takeaways).toEqual([{ name: 'Ana', text: '@everyone read the doc' }])
  })
})

describe('Excel workbook', () => {
  it('round-trips with literal-string cells, numbers and an mm:ss time', async () => {
    const m = buildModel(sample(), new Date())
    const buf = await buildWorkbook(m).xlsx.writeBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Topics', 'Actions', 'Take-aways'])
    const topics = wb.getWorksheet('Topics')
    if (!topics) throw new Error('missing sheet')
    expect(topics.getRow(1).values).toEqual([
      undefined,
      'Rank',
      'Topic',
      'Author',
      'Votes',
      'Status',
      'Time spent',
      'Extensions',
    ])
    expect(topics.getRow(1).font?.bold).toBe(true)
    expect(topics.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(topics.autoFilter).toBeTruthy()
    const injected = topics.getRow(3)
    expect(injected.getCell(2).value).toBe(`'${INJECTIONS[0]}`)
    expect(injected.getCell(2).type).toBe(ExcelJS.ValueType.String)
    expect(injected.getCell(4).type).toBe(ExcelJS.ValueType.Number)
    // Stored as an Excel time value (fraction of a day); readers show it as a time of day.
    const time = topics.getRow(2).getCell(6).value
    expect(time).toBeInstanceOf(Date)
    expect((time as Date).toISOString()).toBe('1899-12-30T00:08:00.000Z')
    expect(topics.getColumn(6).numFmt).toBe('mm:ss')
    expect(wb.getWorksheet('Actions')?.getRow(2).getCell(2).value).toBe("'+1 for buddy system")
    expect(wb.getWorksheet('Take-aways')?.getRow(2).getCell(2).value).toBe(
      "'@everyone read the doc",
    )
    // No formulas anywhere.
    for (const ws of wb.worksheets)
      ws.eachRow((row) => row.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)))
  })
})

describe('Word document', () => {
  it('has real headings, a table with a repeating header, and escaped text', async () => {
    const m = buildModel(sample(), new Date())
    const buf = await Packer.toBuffer(buildDocument(m))
    const zip = await JSZip.loadAsync(buf)
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('w:val="Title"')
    expect(xml).toContain('<w:tblHeader')
    expect(xml).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(xml).not.toContain(XSS)
    expect(xml).toContain('w:w="12240"') // US Letter width
    expect(xml).toContain('w:top="1440"') // 1 inch margin
    const core = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
    expect(core).toContain('Lean Coffee')
    expect(core).toContain('Product team sync')
  })
})

// LibreOffice opening the files is our stand-in for Word and Excel (not available in CI).
describe.skipIf(!process.env.EXPORT_SAMPLES)('LibreOffice conversion', () => {
  it('converts both files to PDF without errors', async () => {
    const dir = process.env.EXPORT_SAMPLES ?? ''
    mkdirSync(dir, { recursive: true })
    const m = buildModel(sample(), new Date())
    writeFileSync(`${dir}/sample-word.docx`, await Packer.toBuffer(buildDocument(m)))
    writeFileSync(
      `${dir}/sample-excel.xlsx`,
      Buffer.from(await buildWorkbook(m).xlsx.writeBuffer()),
    )
    for (const f of ['sample-word.docx', 'sample-excel.xlsx']) {
      execFileSync(
        'soffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', dir, `${dir}/${f}`],
        { timeout: 120_000 },
      )
      expect(existsSync(`${dir}/${f.replace(/\.\w+$/, '.pdf')}`)).toBe(true)
    }
  }, 180_000)
})
