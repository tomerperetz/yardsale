import { describe, it, expect } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { parseGridParams, itemsWhere, itemsOrderBy, filterHref } from '@/lib/grid'
import { NOT_PUBLIC_STATUSES } from '@/lib/visibility'

describe('parseGridParams', () => {
  it('defaults to newest first with no filters', () => {
    expect(parseGridParams({})).toEqual({ sort: 'new' })
  })

  it('reads category, maxPrice and sort', () => {
    expect(parseGridParams({ category: 'ריהוט', maxPrice: '1200', sort: 'price-asc' }))
      .toEqual({ category: 'ריהוט', maxPrice: 120000, sort: 'price-asc' })
  })

  it('ignores a nonsense sort', () => {
    expect(parseGridParams({ sort: 'random' }).sort).toBe('new')
  })

  it('ignores a non-numeric maxPrice', () => {
    expect(parseGridParams({ maxPrice: 'abc' }).maxPrice).toBeUndefined()
  })
})

describe('itemsWhere', () => {
  it('always hides drafts and items the seller has hidden', () => {
    expect(itemsWhere({ sort: 'new' })).toEqual({
      status: { notIn: [ItemStatus.DRAFT, ItemStatus.HIDDEN] },
    })
  })

  it('keeps sold items visible', () => {
    const where = itemsWhere({ sort: 'new' })
    expect(JSON.stringify(where)).not.toContain(ItemStatus.SOLD)
  })

  it('hides every status the shared visibility rule names, so the two cannot drift', () => {
    const excluded = itemsWhere({ sort: 'new' }).status
    expect(excluded).toEqual({ notIn: [...NOT_PUBLIC_STATUSES] })
  })

  it('filters by category name', () => {
    expect(itemsWhere({ sort: 'new', category: 'ריהוט' })).toMatchObject({ category: { name: 'ריהוט' } })
  })

  it('filters by max price in agorot', () => {
    expect(itemsWhere({ sort: 'new', maxPrice: 120000 })).toMatchObject({ priceAgorot: { lte: 120000 } })
  })
})

describe('itemsOrderBy', () => {
  it('sorts newest first by default', () => {
    expect(itemsOrderBy({ sort: 'new' })).toEqual([{ sortIndex: 'asc' }, { createdAt: 'desc' }])
  })

  it('sorts by price ascending and descending', () => {
    expect(itemsOrderBy({ sort: 'price-asc' })).toEqual([{ priceAgorot: 'asc' }])
    expect(itemsOrderBy({ sort: 'price-desc' })).toEqual([{ priceAgorot: 'desc' }])
  })
})

describe('filterHref', () => {
  it('adds a category to an empty query', () => {
    expect(filterHref({ sort: 'new' }, { category: 'ריהוט' })).toBe('/?category=%D7%A8%D7%99%D7%94%D7%95%D7%98')
  })

  it('omits defaults so the canonical url stays clean', () => {
    expect(filterHref({ sort: 'new', category: 'ריהוט' }, { category: undefined })).toBe('/')
  })

  it('preserves the other filters when one changes', () => {
    const href = filterHref({ sort: 'price-asc', maxPrice: 120000 }, { category: 'מטבח' })
    expect(href).toContain('sort=price-asc')
    expect(href).toContain('maxPrice=1200')
  })
})
