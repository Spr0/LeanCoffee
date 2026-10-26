// @vitest-environment node
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Packer } from 'docx'
import type { BoardData } from '../../state/useBoard'
import { boardTotals } from '../session'
import { rpc } from '../supabase'
import type { BoardState, Topic } from '../types'
import { buildDocument, isRtl } from './docx'
import { serverNow } from './download'
import { buildModel } from './model'
import { cellText, exportFilename, xmlSafe } from './sanitize'
import { buildWorkbook } from './xlsx'

// download.ts measures the server clock through rpc('server_time').
vi.mock('../supabase', () => ({ rpc: vi.fn() }))

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
  // Local time, so the expected day holds in any time zone.
  const day = new Date(2026, 9, 24, 15)
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
      {
        id: 'a2',
        board_id: 'b',
        topic_id: null,
        text: 'Share the onboarding doc',
        owner_name: 'Ana',
        created_by: 'x',
        done: true,
        created_at: '2',
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
  it('orders discussed topics by discussion order, then the rest as the board does', () => {
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

  it('gives each topic the same dots as the board after a re-vote', () => {
    // Round 0 ranked everything; the re-vote (round 1) covered only the open topics.
    const data = sample()
    if (!data.state) throw new Error('no state')
    data.state.base_round = 1
    data.topics.push(
      topic('t5', 'Skipped after the first vote', 'Ana', { status: 'skipped', sort_order: 5 }),
    )
    const dot = (id: string, topic_id: string, round: number, dots: number) => ({
      id,
      board_id: 'b',
      topic_id,
      user_id: 'Dev',
      round,
      dots,
    })
    data.votes = [
      dot('v1', 't1', 0, 3),
      dot('v2', 't2', 0, 1),
      dot('v3', 't3', 0, 2),
      dot('v4', 't3', 1, 1),
      dot('v5', 't5', 0, 4),
    ]
    const after = buildModel(data, new Date('2026-10-24T16:30:00Z'))
    expect(after.discussed.map((t) => t.votes)).toEqual([3, 1])
    // Not discussed: the open one has its re-vote dot; the skipped topic, listed after the queue
    // as on the board, keeps its 4 from round 0.
    expect(after.notDiscussed.map((t) => [t.text, t.votes, t.status])).toEqual([
      [XSS, 1, 'Not discussed'],
      ['Skipped after the first vote', 4, 'Skipped'],
    ])
    const board = boardTotals(data.votes, data.topics, 1)
    for (const row of after.all) {
      const id = data.topics.find((t) => row.text.startsWith(t.text) && !t.merged_into)?.id ?? ''
      expect(row.votes).toBe(board.get(id) ?? 0)
    }
  })
})

/** A board in Discuss: two discussed, one on stage, a queue that differs from the votes. */
function midDiscuss(): BoardData {
  const data = sample()
  if (!data.state) throw new Error('no state')
  data.state.ended_at = null
  data.state.phase = 'discuss'
  data.state.current_topic_id = 'c1'
  // The server's segment clock for the topic on stage (not in BoardState's type, but selected).
  Object.assign(data.state, { timer_started_at: '2026-10-24T16:28:30Z' })
  data.topics.push(
    topic('c1', 'On stage now', 'Ana', {
      status: 'discussing',
      sort_order: 1,
      time_spent_ms: 30_000,
      extensions: 1,
    }),
    // The queue as the board shows it: sort_order, whatever the votes say.
    topic('q1', 'First in the queue', 'Dev', { sort_order: 4 }),
    topic('q2', 'Deferred earlier', 'Maya', { sort_order: 9, time_spent_ms: 7_400 }),
    topic('s1', 'Skipped once', 'Ana', { status: 'skipped', sort_order: 2, time_spent_ms: 5_000 }),
  )
  data.votes.push(
    { id: 'v3', board_id: 'b', topic_id: 'q2', user_id: 'Dev', round: 0, dots: 5 },
    { id: 'v4', board_id: 'b', topic_id: 's1', user_id: 'Dev', round: 0, dots: 4 },
    { id: 'v5', board_id: 'b', topic_id: 'c1', user_id: 'Dev', round: 0, dots: 1 },
  )
  return data
}

const action = (
  id: string,
  topic_id: string | null,
  text: string,
  created_at: string,
  done = false,
) => ({
  id,
  board_id: 'b',
  topic_id,
  text,
  owner_name: 'Bo',
  created_by: 'x',
  done,
  created_at,
})

describe('export model on a live board', () => {
  const now = new Date('2026-10-24T16:30:00Z')
  const m = buildModel(midDiscuss(), now)

  it('shows the topic on stage as being discussed, with its time so far', () => {
    expect(m.current).toMatchObject({
      text: 'On stage now',
      status: 'Being discussed',
      timeSpentMs: 120_000, // 0:30 booked earlier plus 1:30 in the running segment
      extensions: 1,
      votes: 1,
    })
    expect(m.notDiscussed.map((t) => t.text)).not.toContain('On stage now')
    expect(m.all.map((t) => t.status)).toEqual([
      'Discussed',
      'Discussed',
      'Being discussed',
      'Not discussed',
      'Not discussed',
      'Partly discussed',
      'Skipped',
    ])
    expect(m.all.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('counts a paused topic only by its booked time', () => {
    const data = midDiscuss()
    Object.assign(data.state ?? {}, { timer_started_at: null })
    expect(buildModel(data, now).current?.timeSpentMs).toBe(30_000)
  })

  it('lists what is left in the board order: the queue, then skipped', () => {
    expect(m.notDiscussed.map((t) => t.text)).toEqual([
      XSS,
      'First in the queue',
      'Deferred earlier',
      'Skipped once',
    ])
  })

  it('tells skipped and partly discussed topics apart, in whole seconds', () => {
    const byText = new Map(m.all.map((t) => [t.text, t]))
    expect(byText.get('Skipped once')).toMatchObject({ status: 'Skipped', timeSpentMs: 5_000 })
    expect(byText.get('Deferred earlier')).toMatchObject({
      status: 'Partly discussed',
      timeSpentMs: 7_000,
    })
    expect(byText.get('First in the queue')).toMatchObject({
      status: 'Not discussed',
      timeSpentMs: 0,
    })
  })

  it('measures the session to the time it is given (the server-corrected clock)', () => {
    expect(m.minutes).toBe(90)
    expect(buildModel(midDiscuss(), new Date('2026-10-24T16:45:00Z')).minutes).toBe(105)
  })

  it('groups actions by topic in board order, oldest first, with deleted topics last', () => {
    const data = midDiscuss()
    data.actions = [
      action('a9', 'gone', 'From a deleted topic', '2026-10-24T15:01:00Z'),
      action('a5', 'c1', 'On stage action', '2026-10-24T16:29:00Z'),
      action('a4', 't2', 'Second topic, later', '2026-10-24T15:40:00Z'),
      action('a3', 't2', 'Second topic, b', '2026-10-24T15:30:00Z'),
      action('a2', 't2', 'Second topic, a', '2026-10-24T15:30:00Z'),
      action('a1', 't1', 'First topic', '2026-10-24T15:20:00Z', true),
      action('a6', 's1', 'From the skipped topic', '2026-10-24T15:10:00Z'),
      action('a7', null, 'Wrap-up action', '2026-10-24T16:29:30Z'),
    ]
    const g = buildModel(data, now)
    expect(g.actionGroups.map((x) => [x.topic, x.actions.map((a) => a.text)])).toEqual([
      ['How do we onboard remote hires? / Async updates nobody reads', ['First topic']],
      [INJECTIONS[0], ['Second topic, a', 'Second topic, b', 'Second topic, later']],
      ['On stage now', ['On stage action']],
      ['Skipped once', ['From the skipped topic']],
      ['Other actions', ['From a deleted topic', 'Wrap-up action']],
    ])
    // The flat list (Excel) follows the same order and names the group.
    expect(g.actions.map((a) => a.topic)).toEqual([
      'How do we onboard remote hires? / Async updates nobody reads',
      INJECTIONS[0],
      INJECTIONS[0],
      INJECTIONS[0],
      'On stage now',
      'Skipped once',
      'Other actions',
      'Other actions',
    ])
    expect(g.actions[0]?.done).toBe(true)
  })
})

describe('session date', () => {
  // Late in the evening, local time: the UTC date is already the next day in the Americas.
  const late = new Date(2026, 9, 25, 23, 30)
  it('names the file with the local day of the session', () => {
    expect(exportFilename('Retro', late, 'docx')).toBe('Retro 2026-10-25.docx')
  })
  it('prints the same day in the Word file, in the reader’s locale', () => {
    const data = sample()
    Object.assign(data.state ?? {}, { started_at: late.toISOString(), ended_at: null })
    const m = buildModel(data, new Date(late.getTime() + 60_000))
    expect(m.dateText).toBe(
      late.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    )
    expect(exportFilename(m.title, m.date, 'xlsx')).toBe('Product team sync 2026-10-25.xlsx')
    expect(buildModel(data, new Date(), 'en-US').dateText).toBe('October 25, 2026')
  })
})

describe('Excel workbook', () => {
  it('round-trips with literal-string cells, numbers and an elapsed [m]:ss time', async () => {
    const m = buildModel(sample(), new Date())
    const buf = await buildWorkbook(m).xlsx.writeBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Topics', 'Actions', 'Take-aways'])
    const topics = wb.getWorksheet('Topics')
    if (!topics) throw new Error('missing sheet')
    expect(topics.getRow(1).values).toEqual([
      undefined,
      '#',
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
    expect(topics.getColumn(6).numFmt).toBe('[m]:ss')
    expect(wb.getWorksheet('Actions')?.getRow(2).getCell(2).value).toBe("'+1 for buddy system")
    const actions = wb.getWorksheet('Actions')
    expect(actions?.getRow(1).values).toEqual([undefined, '#', 'Action', 'Owner', 'Done', 'Topic'])
    expect(actions?.getRow(2).getCell(4).value).toBe('No')
    expect(actions?.getRow(3).getCell(4).value).toBe('Yes')
    // An action without a topic is labelled as the board labels it.
    expect(actions?.getRow(3).getCell(5).value).toBe('Other actions')
    // The topic on every action row stays on one line; other text wraps.
    expect(actions?.getRow(2).getCell(5).alignment?.wrapText ?? false).toBe(false)
    expect(actions?.getRow(2).getCell(2).alignment?.wrapText).toBe(true)
    expect(wb.getWorksheet('Take-aways')?.getRow(2).getCell(2).value).toBe(
      "'@everyone read the doc",
    )
    // Accent header row, banded body, print setup on every sheet.
    for (const ws of wb.worksheets) {
      const head = ws.getRow(1).getCell(1)
      expect(head.fill).toMatchObject({
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF24624A' },
      })
      expect(head.font?.color?.argb).toBe('FFFFFFFF')
      expect(head.font?.bold).toBe(true)
      expect(ws.pageSetup).toMatchObject({
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: '1:1',
      })
    }
    expect(topics.getRow(3).getCell(1).fill).toMatchObject({ fgColor: { argb: 'FFEEF6F1' } })
    expect(
      (topics.getRow(2).getCell(1).fill as ExcelJS.FillPattern | undefined)?.pattern ?? 'none',
    ).toBe('none')
    // No formulas anywhere.
    for (const ws of wb.worksheets)
      ws.eachRow((row) => row.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)))
  })
})

const LONG =
  'How should we split the support rota between the two time zones when half the team is on call and the other half is travelling to the offsite next month?'

/** A board mid-topic with many actions under one long topic, an orphan and a skipped topic. */
function busy(): BoardData {
  const data = midDiscuss()
  data.topics.push(
    topic('long', LONG, 'Bo', { status: 'discussed', discussed_seq: 3, time_spent_ms: 19_991 }),
  )
  data.actions = [
    ...Array.from({ length: 22 }, (_, i) =>
      action(
        `l${String(i).padStart(2, '0')}`,
        'long',
        `Rota step ${i + 1}`,
        `2026-10-24T15:${String(10 + i).padStart(2, '0')}:00Z`,
        i % 3 === 0,
      ),
    ),
    action('o1', 'deleted-topic', 'Orphaned action after delete', '2026-10-24T16:00:00Z'),
  ]
  return data
}

async function documentXml(m: ReturnType<typeof buildModel>) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocument(m)))
  return { zip, xml: (await zip.file('word/document.xml')?.async('string')) ?? '' }
}

/** The visible text of each paragraph, in order. */
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<w:p>.*?<\/w:p>|<w:p .*?<\/w:p>/g)].map((p) =>
    [...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  )

describe('Word document', () => {
  it('has real headings, a table with a repeating header, and escaped text', async () => {
    const m = buildModel(sample(), new Date())
    const { zip, xml } = await documentXml(m)
    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('w:val="Title"')
    expect(xml).toContain('<w:tblHeader')
    expect(xml).toContain('w:fill="24624A"') // accent header row
    expect(xml).toContain('✓') // done action is checked
    expect(xml).toContain('SESSION LENGTH') // key-facts box
    const footer = Object.keys(zip.files).find((f) => /^word\/footer\d*\.xml$/.test(f)) ?? ''
    const footerXml = (await zip.file(footer)?.async('string')) ?? ''
    expect(footerXml).toContain('PAGE')
    expect(footerXml).toContain('NUMPAGES')
    const styles = (await zip.file('word/styles.xml')?.async('string')) ?? ''
    expect(styles).toContain('w:color w:val="24624A"') // headings in the accent
    expect(xml).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(xml).not.toContain(XSS)
    expect(xml).toContain('w:w="12240"') // US Letter width
    expect(xml).toContain('w:top="1440"') // 1 inch margin
    const core = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
    expect(core).toContain('Lean Coffee')
    expect(core).toContain('Product team sync')
  })

  it('lays out right-to-left topics from the right, as the board does', async () => {
    expect(isRtl('مرحبا بالجميع')).toBe(true)
    expect(isRtl('  "שלום" world')).toBe(true)
    expect(isRtl('Hello مرحبا')).toBe(false)
    expect(isRtl('2026 🙂')).toBe(false)
    const m = buildModel(sample(), new Date())
    const first = m.discussed[0]
    if (!first) throw new Error('sample has a discussed topic')
    const arabic = 'كيف نراجع الشيفرة أسرع؟'
    const { xml } = await documentXml({ ...m, discussed: [{ ...first, text: arabic }] })
    const para = [...xml.matchAll(/<w:p>.*?<\/w:p>|<w:p .*?<\/w:p>/g)]
      .map((p) => p[0])
      .find((p) => p.includes(arabic))
    expect(para).toContain('<w:bidi/>')
    expect(para).toContain('<w:rtl/>')
    // Left-to-right paragraphs are unchanged.
    expect(xml.match(/<w:bidi\/>/g)).toHaveLength(1)
  })

  it('prints the topic on stage with its time so far, and what happened to the rest', async () => {
    const { xml } = await documentXml(buildModel(midDiscuss(), new Date('2026-10-24T16:30:00Z')))
    const text = paragraphs(xml)
    const at = (heading: string) => text.indexOf(heading)
    expect(at('Discussed')).toBeLessThan(at('Being discussed'))
    expect(at('Being discussed')).toBeLessThan(at('Actions'))
    expect(text[at('Being discussed') + 1]).toBe(
      'On stage now (Ana; 1 vote; 2:00 so far; 1 extension)',
    )
    expect(text.slice(at('Not discussed') + 1)).toEqual([
      '&lt;img src=x onerror=alert(1)&gt; (2 votes)',
      'First in the queue (0 votes)',
      'Deferred earlier (5 votes; partly discussed, 0:07)',
      'Skipped once (4 votes; skipped after 0:05)',
    ])
  })

  it('groups actions under each topic once, with banding and Other actions last', async () => {
    const { xml } = await documentXml(buildModel(busy(), new Date('2026-10-24T16:30:00Z')))
    // The long topic appears twice: in Discussed, and once over its 22 actions.
    expect(xml.split(LONG).length - 1).toBe(2)
    expect(xml).not.toMatch(/<w:t[^>]*>Topic<\/w:t>/) // no per-row Topic column
    expect(xml).toContain('<w:gridSpan w:val="3"/>')
    expect(xml).toContain('w:fill="EEF6F1"') // banded second row of a group
    const table = paragraphs(xml.slice(xml.lastIndexOf('<w:tbl>'), xml.lastIndexOf('</w:tbl>')))
    expect(table.slice(0, 4)).toEqual(['Done', 'Action', 'Owner', LONG])
    const rota = table.indexOf(LONG)
    expect(table.slice(rota + 1, rota + 7)).toEqual([
      '✓',
      'Rota step 1',
      'Bo',
      '',
      'Rota step 2',
      'Bo',
    ])
    expect(table.slice(-4)).toEqual(['Other actions', '', 'Orphaned action after delete', 'Bo'])
  })
})

describe('server clock for downloads', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(rpc).mockReset()
  })
  it('uses the server time, corrected for the round trip', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T16:00:00Z'), toFake: ['Date'] })
    vi.mocked(rpc).mockResolvedValue('2026-10-24T16:15:00Z')
    expect((await serverNow()).toISOString()).toBe('2026-10-24T16:15:00.000Z')
    expect(rpc).toHaveBeenCalledWith('server_time')
  })
  it("falls back to this computer's clock when the server cannot be reached", async () => {
    vi.mocked(rpc).mockRejectedValue(new Error('network'))
    const before = Date.now()
    expect((await serverNow()).getTime()).toBeGreaterThanOrEqual(before)
  })
})

// LibreOffice opening the files is our stand-in for Word and Excel (not available in CI).
describe.skipIf(!process.env.EXPORT_SAMPLES)('LibreOffice conversion', () => {
  const dir = process.env.EXPORT_SAMPLES ?? ''
  const soffice = (to: string, file: string) =>
    execFileSync('soffice', ['--headless', '--convert-to', to, '--outdir', dir, `${dir}/${file}`], {
      timeout: 120_000,
    })
  const samples = [
    ['sample', buildModel(sample(), new Date())],
    // Mid-topic, 22 actions under a 150-character topic, an orphaned action, odd milliseconds.
    ['sample-live', buildModel(busy(), new Date('2026-10-24T16:30:00Z'))],
  ] as const

  it('converts every file to PDF without errors', async () => {
    mkdirSync(dir, { recursive: true })
    for (const [name, m] of samples) {
      writeFileSync(`${dir}/${name}-word.docx`, await Packer.toBuffer(buildDocument(m)))
      writeFileSync(
        `${dir}/${name}-excel.xlsx`,
        Buffer.from(await buildWorkbook(m).xlsx.writeBuffer()),
      )
      for (const f of [`${name}-word.docx`, `${name}-excel.xlsx`]) {
        soffice('pdf', f)
        expect(existsSync(`${dir}/${f.replace(/\.\w+$/, '.pdf')}`)).toBe(true)
      }
    }
  }, 300_000)

  it('shows times as the board does and keeps grouped actions short', () => {
    // CSV with "save cell contents as shown" (the ninth option): the times as LibreOffice shows
    // them, in whole seconds and never one short.
    soffice(
      'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true',
      'sample-live-excel.xlsx',
    )
    const rows = readFileSync(`${dir}/sample-live-excel.csv`, 'utf8').split('\n')
    const row = (text: string) => rows.find((r) => r.includes(text)) ?? ''
    expect(row('Rota step')).toBe('') // first sheet only: Topics
    expect(row('support rota')).toMatch(/,0:20,0$/)
    expect(row('On stage now')).toMatch(/,Being discussed,2:00,1$/)
    expect(row('Deferred earlier')).toMatch(/,Partly discussed,0:07,0$/)
    // The Actions sheet keeps one line per action (it ran to four pages).
    soffice('pdf', 'sample-live-excel.xlsx')
    const sheets = readFileSync(`${dir}/sample-live-excel.pdf`, 'latin1')
    expect(sheets.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBeLessThanOrEqual(3)
    // 22 actions under one long topic used to run to five pages.
    const pdf = readFileSync(`${dir}/sample-live-word.pdf`, 'latin1')
    const pages = pdf.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0
    expect(pages).toBeGreaterThan(0)
    expect(pages).toBeLessThanOrEqual(2)
  }, 180_000)
})
