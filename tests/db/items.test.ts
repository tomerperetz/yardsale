import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeCategory, makeItem } from '../helpers/factories'
import { getPublicCategories, getPublicItem } from '@/lib/items'

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
