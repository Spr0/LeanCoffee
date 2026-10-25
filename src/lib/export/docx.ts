import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { mss, type ExportModel } from './model'
import { EXPORT_COLORS as C } from './palette'
import { xmlSafe } from './sanitize'

const t = (text: string) => xmlSafe(text)
const INCH = 1440 // twips
const CONTENT = 12240 - 2 * INCH // US Letter width minus margins, in twips
const rule = { style: BorderStyle.SINGLE, size: 4, color: C.rule }
const none = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const fill = (color: string) => ({ type: ShadingType.CLEAR, color: 'auto', fill: color })
const CHECK = '✓' // ✓, set in Segoe UI Symbol because Calibri has no check mark

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Key facts under the title: one shaded row of four label/value cells. */
function factsBox(m: ExportModel, longDate: string): Table {
  const facts: [string, string][] = [
    ['Date', longDate],
    ['People', String(m.people)],
    ['Session length', `${m.minutes} min`],
    ['Topics discussed', `${m.discussed.length} of ${m.all.length}`],
  ]
  const width = CONTENT / facts.length
  const gap = { style: BorderStyle.SINGLE, size: 24, color: 'FFFFFF' }
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: facts.map(() => width),
    layout: TableLayoutType.FIXED,
    borders: {
      top: none,
      bottom: none,
      left: none,
      right: none,
      insideHorizontal: none,
      insideVertical: gap,
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: facts.map(
          ([label, value]) =>
            new TableCell({
              width: { size: width, type: WidthType.DXA },
              shading: fill(C.soft),
              margins: { top: 100, bottom: 100, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: label.toUpperCase(),
                      bold: true,
                      size: 16,
                      color: C.accent,
                    }),
                  ],
                }),
                new Paragraph({
                  children: [new TextRun({ text: t(value), bold: true, size: 26 })],
                }),
              ],
            }),
        ),
      }),
    ],
  })
}

/** Actions table: accent header row that repeats on every page, banded rows, a check for done. */
function actionsTable(m: ExportModel): Table {
  const widths = [720, 4140, 1800, 2700] // Done, Action, Owner, Topic; sums to CONTENT
  const headRule = { style: BorderStyle.SINGLE, size: 4, color: C.accent }
  const head = (text: string, i: number) =>
    new TableCell({
      width: { size: widths[i] ?? 0, type: WidthType.DXA },
      shading: fill(C.accent),
      borders: { top: headRule, bottom: headRule, left: headRule, right: headRule },
      children: [
        new Paragraph({ children: [new TextRun({ text, bold: true, color: C.onAccent })] }),
      ],
    })
  const cell = (i: number, band: boolean, run: TextRun, center = false) =>
    new TableCell({
      width: { size: widths[i] ?? 0, type: WidthType.DXA },
      shading: band ? fill(C.band) : undefined,
      borders: { top: rule, bottom: rule, left: rule, right: rule },
      children: [
        new Paragraph({ alignment: center ? AlignmentType.CENTER : undefined, children: [run] }),
      ],
    })
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: ['Done', 'Action', 'Owner', 'Topic'].map(head),
      }),
      ...m.actions.map((a, i) => {
        const band = i % 2 === 1
        return new TableRow({
          cantSplit: true,
          children: [
            cell(
              0,
              band,
              new TextRun({
                text: a.done ? CHECK : '',
                bold: true,
                color: C.accent,
                font: 'Segoe UI Symbol',
              }),
              true,
            ),
            cell(1, band, new TextRun(t(a.text))),
            cell(2, band, new TextRun(t(a.owner))),
            cell(3, band, new TextRun(t(a.topic))),
          ],
        })
      }),
    ],
  })
}

/** Word summary: US Letter, 1 inch margins, Calibri 11, real heading styles and a real table. */
export function buildDocument(m: ExportModel): Document {
  const longDate = m.date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const children: (Paragraph | Table)[] = [
    // The key-facts box carries the date, people and length, so no summary line repeats them.
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 160 },
      children: [new TextRun(t(m.title))],
    }),
    factsBox(m, longDate),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Discussed')] }),
  ]
  if (m.discussed.length === 0) children.push(new Paragraph('No topics were discussed.'))
  for (const d of m.discussed) {
    children.push(
      new Paragraph({
        numbering: { reference: 'discussed', level: 0 },
        children: [
          new TextRun({ text: t(d.text), bold: true }),
          new TextRun({
            text: ` (${t(d.author)}; ${plural(d.votes, 'vote')}; ${mss(d.timeSpentMs)}; ${plural(d.extensions, 'extension')})`,
          }),
        ],
      }),
    )
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Actions')] }),
  )
  if (m.actions.length === 0) children.push(new Paragraph('No actions were captured.'))
  else children.push(actionsTable(m))

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Take-aways')] }),
  )
  if (m.takeaways.length === 0) children.push(new Paragraph('No take-aways were shared.'))
  for (const k of m.takeaways) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${t(k.name)}: `, bold: true }), new TextRun(t(k.text))],
      }),
    )
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Not discussed')] }),
  )
  if (m.notDiscussed.length === 0) children.push(new Paragraph('Every topic was discussed.'))
  for (const n of m.notDiscussed) {
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(`${t(n.text)} (${plural(n.votes, 'vote')})`)],
      }),
    )
  }

  return new Document({
    title: t(m.title),
    creator: 'Lean Coffee',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
        title: {
          run: { font: 'Calibri', size: 48, bold: true, color: C.accent },
          paragraph: { spacing: { after: 60 } },
        },
        heading1: {
          run: { font: 'Calibri', size: 30, bold: true, color: C.accent },
          paragraph: { spacing: { before: 360, after: 120 }, keepNext: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'discussed',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              // Hanging indent so wrapped lines line up with the topic, not the number.
              style: { paragraph: { indent: { left: 360, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: { top: INCH, bottom: INCH, left: INCH, right: INCH },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: C.muted,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
}

export function buildDocx(m: ExportModel): Promise<Blob> {
  return Packer.toBlob(buildDocument(m))
}
