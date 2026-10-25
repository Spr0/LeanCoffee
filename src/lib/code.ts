/** Board codes are 8 characters from an unambiguous alphabet, shown as two groups of four. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function isValidCode(input: string): boolean {
  const code = normalizeCode(input)
  return code.length === 8 && [...code].every((c) => CODE_ALPHABET.includes(c))
}

export function formatCode(input: string): string {
  const code = normalizeCode(input)
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
