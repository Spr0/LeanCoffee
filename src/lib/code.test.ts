import { formatCode, isValidCode, normalizeCode } from './code'

describe('board codes', () => {
  it('normalizes case, spaces and dashes', () => {
    expect(normalizeCode(' kq74-m2x9 ')).toBe('KQ74M2X9')
  })
  it('formats as two groups of four', () => {
    expect(formatCode('kq74m2x9')).toBe('KQ74-M2X9')
  })
  it('accepts only 8 characters from the unambiguous alphabet', () => {
    expect(isValidCode('KQ74-M2X9')).toBe(true)
    expect(isValidCode('KQ74-M2X')).toBe(false)
    expect(isValidCode('KQ74-M2X0')).toBe(false) // 0 is excluded
    expect(isValidCode('IQ74-M2X9')).toBe(false) // I is excluded
  })
})
