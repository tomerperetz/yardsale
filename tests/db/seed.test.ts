import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { seed } from '../../prisma/seed'
import { STARTER_CATEGORIES } from '@/lib/starter-categories'

describe('seed', () => {
  beforeEach(resetDb)

  it('creates exactly one settings row', async () => {
    await seed()
    const rows = await db.settings.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
  })

  it('leaves every seller-facing field empty', async () => {
    await seed()
    const s = await db.settings.findFirstOrThrow()
    expect(s.shopName).toBe('')
    expect(s.tagline).toBe('')
    expect(s.bitPhone).toBe('')
    expect(s.addressLine).toBe('')
    expect(s.city).toBe('')
  })

  it('defaults the hold to 15 minutes', async () => {
    await seed()
    const s = await db.settings.findFirstOrThrow()
    expect(s.holdMinutes).toBe(15)
  })

  it('is idempotent', async () => {
    await seed()
    await seed()
    expect(await db.settings.count()).toBe(1)
  })

  it('creates the five categories a shop starts with', async () => {
    // Without them the AI import is asked to pick "from the seller's own
    // list" against an empty list, proposes one per item, and the shop drifts
    // into a set nobody chose.
    await seed()
    const names = (await db.category.findMany({ select: { name: true } })).map((c) => c.name)
    expect(names.sort()).toEqual([...STARTER_CATEGORIES].sort())
  })

  it('leaves a category the shop already has exactly where it is', async () => {
    const mine = await db.category.create({ data: { name: 'ריהוט', slug: 'my-own-slug' } })
    await seed()

    const rows = await db.category.findMany({ where: { name: 'ריהוט' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(mine.id)
    expect(rows[0].slug).toBe('my-own-slug')
  })

  it('creates no items', async () => {
    await seed()
    expect(await db.item.count()).toBe(0)
  })
})
