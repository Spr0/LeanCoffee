/* eslint-disable no-control-regex -- these sanitizers exist to match control characters */
/** Characters not allowed in XML 1.0 (both .docx and .xlsx are XML inside a zip). */
const XML_INVALID =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function xmlSafe(text: string): string {
  return text.replace(XML_INVALID, '')
}

/**
 * Spreadsheet formula injection guard (CSV/Excel injection). A cell that starts with one of these
 * characters could be read as a formula, so it is written as a string with a leading apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/

export function cellText(text: string): string {
  const safe = xmlSafe(text)
  return FORMULA_START.test(safe) ? `'${safe}` : safe
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** YYYY-MM-DD of the local calendar day, the same day the Word file prints. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * "{Board name} {YYYY-MM-DD}.{ext}", safe on Windows; falls back to "Lean Coffee {date}". The date
 * is the local day of `date` (the session's start), so it agrees with the date in the Word file.
 */
export function exportFilename(boardName: string, date: Date, ext: 'docx' | 'xlsx'): string {
  const day = localDay(date)
  let base = xmlSafe(boardName)
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (!base || RESERVED.test(base) || RESERVED.test(base.split('.')[0] ?? '')) base = 'Lean Coffee'
  const name = `${base} ${day}`.slice(0, 100 - ext.length - 1).replace(/[. ]+$/, '')
  return `${name}.${ext}`
}
