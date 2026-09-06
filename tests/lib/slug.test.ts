import { describe, it, expect } from 'vitest'
import { decodeSlugParam, hebrewSlug, randomSuffix } from '@/lib/slug'

describe('hebrewSlug', () => {
  it('keeps hebrew letters and hyphenates whitespace', () => {
    expect(hebrewSlug('ספה תלת מושבית', 'k3f9tq')).toBe('ספה-תלת-מושבית-k3f9tq')
  })

  it('drops punctuation and quote marks', () => {
    expect(hebrewSlug('אופני הרים ״26', 'aaaaaa')).toBe('אופני-הרים-26-aaaaaa')
  })

  it('keeps latin letters and digits', () => {
    expect(hebrewSlug('Sony WH-1000XM4', 'bbbbbb')).toBe('sony-wh-1000xm4-bbbbbb')
  })

  it('collapses runs of whitespace and hyphens', () => {
    expect(hebrewSlug('ספה   —   אפורה', 'cccccc')).toBe('ספה-אפורה-cccccc')
  })

  it('falls back to the suffix alone when nothing survives', () => {
    expect(hebrewSlug('!!!', 'dddddd')).toBe('dddddd')
  })

  it('truncates a very long name', () => {
    const slug = hebrewSlug('א'.repeat(200), 'eeeeee')
    expect(slug.length).toBeLessThanOrEqual(87)
    expect(slug.endsWith('-eeeeee')).toBe(true)
  })
})

describe('decodeSlugParam', () => {
  it('decodes a percent-encoded Hebrew slug, the shape a route param arrives in', () => {
    const encoded = encodeURIComponent('ספה-תלת-מושבית-0522eb')
    expect(decodeSlugParam(encoded)).toBe('ספה-תלת-מושבית-0522eb')
  })

  it('leaves a plain ascii slug unchanged', () => {
    expect(decodeSlugParam('sony-wh-1000xm4-bbbbbb')).toBe('sony-wh-1000xm4-bbbbbb')
  })

  it('falls back to the raw value instead of throwing on a malformed escape', () => {
    expect(decodeSlugParam('50%-off')).toBe('50%-off')
  })
})

describe('randomSuffix', () => {
  it('is six base36 characters', () => {
    expect(randomSuffix()).toMatch(/^[a-z0-9]{6}$/)
  })

  it('differs between calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomSuffix()))
    expect(seen.size).toBeGreaterThan(45)
  })
})
