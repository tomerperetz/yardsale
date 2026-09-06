import { describe, it, expect } from 'vitest'
import { normalizeForCompare, editDistance, suggestMerges } from '@/lib/admin/categories'

describe('normalizeForCompare', () => {
  it('trims, collapses whitespace and strips a leading he', () => {
    expect(normalizeForCompare('  הריהוט  ')).toBe('ריהוט')
    expect(normalizeForCompare('ריהוט   לבית')).toBe('ריהוט לבית')
  })
})

describe('editDistance', () => {
  it('is zero for identical strings', () => {
    expect(editDistance('ריהוט', 'ריהוט')).toBe(0)
  })

  it('counts single edits', () => {
    expect(editDistance('ריהוט', 'ריהוץ')).toBe(1)
    expect(editDistance('ספרים', 'ספר')).toBe(2)
  })
})

describe('suggestMerges', () => {
  const cat = (id: string, name: string) => ({ id, name })

  it('suggests a whole-word containment', () => {
    const s = suggestMerges([cat('a', 'ריהוט'), cat('b', 'ריהוט לבית')], [])
    expect(s).toEqual([{ aId: 'a', bId: 'b' }])
  })

  it('suggests a near-typo', () => {
    const s = suggestMerges([cat('a', 'אלקטרוניקה'), cat('b', 'אלקטרוניקהה')], [])
    expect(s).toHaveLength(1)
  })

  it('suggests names that differ only by a leading he', () => {
    expect(suggestMerges([cat('a', 'ספרים'), cat('b', 'הספרים')], [])).toHaveLength(1)
  })

  it('leaves genuinely different categories alone', () => {
    expect(suggestMerges([cat('a', 'ריהוט'), cat('b', 'ספורט'), cat('c', 'מטבח')], [])).toEqual([])
  })

  it('respects a dismissed pair', () => {
    expect(suggestMerges([cat('a', 'ריהוט'), cat('b', 'ריהוט לבית')], ['a:b'])).toEqual([])
  })

  it('never suggests a category against itself', () => {
    expect(suggestMerges([cat('a', 'ריהוט')], [])).toEqual([])
  })
})
