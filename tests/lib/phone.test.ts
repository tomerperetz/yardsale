import { describe, it, expect } from 'vitest'
import { normalizeIsraeliMobile, toInternational } from '@/lib/phone'

describe('normalizeIsraeliMobile', () => {
  it('strips hyphens and spaces', () => {
    expect(normalizeIsraeliMobile('052-741-8830')).toBe('0527418830')
    expect(normalizeIsraeliMobile('052 741 8830')).toBe('0527418830')
  })

  it('accepts an already-clean number', () => {
    expect(normalizeIsraeliMobile('0527418830')).toBe('0527418830')
  })

  it('accepts the international form', () => {
    expect(normalizeIsraeliMobile('+972527418830')).toBe('0527418830')
    expect(normalizeIsraeliMobile('972527418830')).toBe('0527418830')
  })

  it('rejects a landline', () => {
    expect(normalizeIsraeliMobile('039876543')).toBeNull()
  })

  it('rejects the wrong length', () => {
    expect(normalizeIsraeliMobile('05274188')).toBeNull()
    expect(normalizeIsraeliMobile('05274188301')).toBeNull()
  })

  it('rejects letters and empty input', () => {
    expect(normalizeIsraeliMobile('abc')).toBeNull()
    expect(normalizeIsraeliMobile('')).toBeNull()
  })
})

describe('toInternational', () => {
  it('replaces the leading zero with the country code', () => {
    expect(toInternational('0527418830')).toBe('972527418830')
  })
})
