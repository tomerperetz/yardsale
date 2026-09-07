import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeCategory, makeItem } from '../helpers/factories'
import { getPublicCategories, getPublicItem, getPublicItemsByIds } from '@/lib/items'
import { setItemStatus } from '@/lib/admin/items'
import { itemsWhere } from '@/lib/grid'

describe('getPublicItem', () => {
  beforeEach(resetDb)

  it('returns an available item with its photos and category', async () => {
    const item = await makeItem()
    const found = await getPublicItem(item.slug)
    expect(found?.id).toBe(item.id)
    expect(found?.category).toBeDefined()
    expect(Array.isArray(found?.photos)).toBe(true)
  })

  it('returns a sold item, because sold items stay visible', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    expect(await getPublicItem(item.slug)).not.toBeNull()
  })

  it('hides a draft', async () => {
    const item = await makeItem({ status: ItemStatus.DRAFT })
    expect(await getPublicItem(item.slug)).toBeNull()
  })

  it('returns null for an unknown slug', async () => {
    expect(await getPublicItem('nope-zzzzzz')).toBeNull()
  })

  it('orders photos by position', async () => {
    const item = await makeItem()
    await db.photo.createMany({
      data: [
        { itemId: item.id, width: 800, height: 600, lqip: 'x', position: 2 },
        { itemId: item.id, width: 800, height: 600, lqip: 'y', position: 0 },
        { itemId: item.id, width: 800, height: 600, lqip: 'z', position: 1 },
      ],
    })
    const found = await getPublicItem(item.slug)
    expect(found?.photos.map((p) => p.position)).toEqual([0, 1, 2])
  })
})

describe('a hidden item is invisible to buyers everywhere', () => {
  beforeEach(resetDb)

  it('does not resolve by slug, so a shared link stops working while hidden', async () => {
    const item = await makeItem({ status: ItemStatus.HIDDEN })
    expect(await getPublicItem(item.slug)).toBeNull()
  })

  it('resolves again once it is back on sale, at the same slug', async () => {
    const item = await makeItem({ status: ItemStatus.HIDDEN })
    await setItemStatus(item.id, 'AVAILABLE')

    const found = await getPublicItem(item.slug)
    expect(found?.id).toBe(item.id)
    expect(found?.slug).toBe(item.slug)
  })

  it('is dropped from a cart lookup rather than checked out', async () => {
    const hidden = await makeItem({ status: ItemStatus.HIDDEN })
    const visible = await makeItem({ status: ItemStatus.AVAILABLE })

    const found = await getPublicItemsByIds([hidden.id, visible.id])
    expect(found.map((i) => i.id)).toEqual([visible.id])
  })

  it('is excluded from the grid', async () => {
    const hidden = await makeItem({ status: ItemStatus.HIDDEN })
    const visible = await makeItem({ status: ItemStatus.AVAILABLE })

    const shown = await db.item.findMany({ where: itemsWhere({ sort: 'new' }) })
    expect(shown.map((i) => i.id)).toEqual([visible.id])
    expect(shown.map((i) => i.id)).not.toContain(hidden.id)
  })

  it('takes its category out of the filter bar when it was the only item there', async () => {
    const category = await makeCategory('כלי גינה')
    const item = await makeItem({ categoryId: category.id, status: ItemStatus.AVAILABLE })

    expect((await getPublicCategories()).map((c) => c.name)).toEqual(['כלי גינה'])
    await setItemStatus(item.id, 'HIDDEN')
    expect(await getPublicCategories()).toEqual([])
  })
})

describe('getPublicCategories', () => {
  beforeEach(resetDb)

  it('offers a category that has something a buyer can see', async () => {
    const category = await makeCategory('ריהוט')
    await makeItem({ categoryId: category.id })

    expect((await getPublicCategories()).map((c) => c.name)).toEqual(['ריהוט'])
  })

  it('still offers a category whose only item is sold, since sold items stay in the grid', async () => {
    const category = await makeCategory('ספרים')
    await makeItem({ categoryId: category.id, status: ItemStatus.SOLD })

    expect((await getPublicCategories()).map((c) => c.name)).toEqual(['ספרים'])
  })

  it('hides a category holding nothing but drafts', async () => {
    const category = await makeCategory('כללי')
    await makeItem({ categoryId: category.id, status: ItemStatus.DRAFT })

    expect(await getPublicCategories()).toEqual([])
  })

  it('hides a category with no items at all', async () => {
    await makeCategory('ריק')

    expect(await getPublicCategories()).toEqual([])
  })
})
