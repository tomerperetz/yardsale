import { describe, it, expect, beforeEach } from 'vitest'
import { EventKind } from '@prisma/client'
import { db } from '@/lib/db'
import { itemInterest, totals, visitorsByDay, since } from '@/lib/analytics/insights'
import { resetDb } from '../helpers/db'
import { makeItem } from '../helpers/factories'

const NOW = new Date('2026-09-20T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function event(visitorId: string, kind: EventKind, itemId: string | null, at: Date = NOW) {
  return db.event.create({ data: { visitorId, kind, itemId, createdAt: at } })
}

describe('since', () => {
  it('is null for the whole history, so the query drops its date filter', () => {
    expect(since(null, NOW)).toBeNull()
  })

  it('counts back whole days', () => {
    expect(since(7, NOW)).toEqual(new Date('2026-09-13T12:00:00Z'))
  })
})

describe('totals', () => {
  beforeEach(resetDb)

  it('counts a browser once however many times it came back', async () => {
    // The number the seller asked for is people, not requests. One buyer
    // refreshing the grid eleven times is one person.
    for (let i = 0; i < 11; i++) await event('aaa', EventKind.VIEW_SHOP, null)
    await event('bbb', EventKind.VIEW_SHOP, null)

    expect(await totals(null, NOW)).toMatchObject({ visitors: 2, shopViews: 12 })
  })

  it('counts someone who only ever opened an item link as a visitor', async () => {
    // Most of this shop's traffic arrives on an item link from WhatsApp and
    // never sees the grid. Counting only shop views would miss them entirely.
    const item = await makeItem()
    await event('ccc', EventKind.VIEW_ITEM, item.id)

    expect(await totals(null, NOW)).toMatchObject({ visitors: 1, shopViews: 0, itemViews: 1 })
  })

  it('separates the three kinds', async () => {
    const item = await makeItem()
    await event('a', EventKind.VIEW_SHOP, null)
    await event('a', EventKind.VIEW_ITEM, item.id)
    await event('a', EventKind.ADD_TO_CART, item.id)

    expect(await totals(null, NOW)).toEqual({ visitors: 1, shopViews: 1, itemViews: 1, addsToCart: 1 })
  })

  it('leaves out everything older than the window', async () => {
    await event('old', EventKind.VIEW_SHOP, null, daysAgo(40))
    await event('recent', EventKind.VIEW_SHOP, null, daysAgo(3))

    expect(await totals(7, NOW)).toMatchObject({ visitors: 1, shopViews: 1 })
    expect(await totals(30, NOW)).toMatchObject({ visitors: 1 })
    expect(await totals(null, NOW)).toMatchObject({ visitors: 2 })
  })

  it('reports zeroes on a shop nobody has visited', async () => {
    expect(await totals(null, NOW)).toEqual({ visitors: 0, shopViews: 0, itemViews: 0, addsToCart: 0 })
  })
})

describe('itemInterest', () => {
  beforeEach(resetDb)

  it('separates how many people from how many times', async () => {
    // The two disagree in the way that matters: eighty views from three people
    // is three people who cannot decide; three views from three people is
    // three people who looked once.
    const item = await makeItem()
    for (let i = 0; i < 8; i++) await event('one-person', EventKind.VIEW_ITEM, item.id)
    await event('another', EventKind.VIEW_ITEM, item.id)

    const [row] = await itemInterest(null, NOW)
    expect(row).toEqual({ itemId: item.id, views: 9, viewers: 2, addsToCart: 0 })
  })

  it('counts adds to cart alongside views', async () => {
    const item = await makeItem()
    await event('a', EventKind.VIEW_ITEM, item.id)
    await event('a', EventKind.ADD_TO_CART, item.id)
    await event('b', EventKind.ADD_TO_CART, item.id)

    const [row] = await itemInterest(null, NOW)
    expect(row).toMatchObject({ views: 1, viewers: 1, addsToCart: 2 })
  })

  it('keeps each item to its own row', async () => {
    const a = await makeItem()
    const b = await makeItem()
    await event('x', EventKind.VIEW_ITEM, a.id)
    await event('y', EventKind.VIEW_ITEM, b.id)
    await event('z', EventKind.VIEW_ITEM, b.id)

    const rows = await itemInterest(null, NOW)
    expect(rows.find((r) => r.itemId === a.id)).toMatchObject({ viewers: 1 })
    expect(rows.find((r) => r.itemId === b.id)).toMatchObject({ viewers: 2 })
  })

  it('never returns a row for a shop-wide event', async () => {
    await event('a', EventKind.VIEW_SHOP, null)
    expect(await itemInterest(null, NOW)).toEqual([])
  })

  it('honours the window', async () => {
    const item = await makeItem()
    await event('old', EventKind.VIEW_ITEM, item.id, daysAgo(20))
    await event('new', EventKind.VIEW_ITEM, item.id, daysAgo(2))

    expect((await itemInterest(7, NOW))[0]).toMatchObject({ views: 1 })
    expect((await itemInterest(30, NOW))[0]).toMatchObject({ views: 2 })
  })

  it('returns plain numbers, not the bigints Postgres counts in', async () => {
    // A bigint cannot be serialised into a client component, and these are
    // rendered straight into a table.
    const item = await makeItem()
    await event('a', EventKind.VIEW_ITEM, item.id)

    const [row] = await itemInterest(null, NOW)
    expect(typeof row.views).toBe('number')
    expect(typeof row.viewers).toBe('number')
    expect(typeof row.addsToCart).toBe('number')
  })

  it('loses an item’s history when the item is deleted, rather than leaving orphans', async () => {
    const item = await makeItem()
    await event('a', EventKind.VIEW_ITEM, item.id)

    await db.item.delete({ where: { id: item.id } })

    expect(await itemInterest(null, NOW)).toEqual([])
    expect(await db.event.count()).toBe(0)
  })
})

describe('visitorsByDay', () => {
  beforeEach(resetDb)

  it('gives every day in the window a row, including the quiet ones', async () => {
    // A chart that skips empty days draws a quiet week as a straight line
    // between two busy ones.
    await event('a', EventKind.VIEW_SHOP, null, daysAgo(0))
    await event('b', EventKind.VIEW_SHOP, null, daysAgo(0))

    const days = await visitorsByDay(14, NOW)

    expect(days).toHaveLength(14)
    expect(days[13]).toEqual({ day: '2026-09-20', visitors: 2 })
    expect(days.filter((d) => d.visitors === 0)).toHaveLength(13)
  })

  it('is oldest first, which in an RTL page puts the oldest day on the right', async () => {
    const days = await visitorsByDay(5, NOW)
    expect(days.map((d) => d.day)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'])
  })

  it('counts a browser once per day, not once per visit', async () => {
    for (let i = 0; i < 5; i++) await event('same', EventKind.VIEW_SHOP, null, daysAgo(1))
    const days = await visitorsByDay(14, NOW)
    expect(days[12].visitors).toBe(1)
  })
})
