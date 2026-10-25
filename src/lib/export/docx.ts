import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { mss, type ExportModel } from './model'
import { xmlSafe } from './sanitize'

const t = (text: string) => xmlSafe(text)
const INCH = 1440 // twips
const border = { style: BorderStyle.SINGLE, size: 6, color: '8A9894' }

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Word summary: US Letter, 1 inch margins, Calibri 11, real heading styles and a real table. */
export function buildDocument(m: ExportModel): Document {
  const longDate = m.date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(t(m.title))] }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Lean Coffee, ${longDate}, ${m.people} people, ${m.minutes} min`,
          color: '55625F',
        }),
      ],
    }),
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
  if (m.actions.length === 0) {
    children.push(new Paragraph('No actions were captured.'))
  } else {
    const cell = (text: string, bold = false) =>
      new TableCell({
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({ children: [new TextRun({ text: t(text), bold })] })],
      })
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [cell('Action', true), cell('Owner', true), cell('Topic', true)],
          }),
          ...m.actions.map(
            (a) => new TableRow({ children: [cell(a.text), cell(a.owner), cell(a.topic)] }),
          ),
        ],
      }),
    )
  }

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
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'discussed',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
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
        children,
      },
    ],
  })
}

export function buildDocx(m: ExportModel): Promise<Blob> {
  return Packer.toBlob(buildDocument(m))
}
