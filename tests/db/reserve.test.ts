import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus, PickupSlot } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { MAX_ITEMS_PER_ORDER, reserveItems } from '@/lib/orders/reserve'
import { utcDate } from '@/lib/dates'
import { seed } from '../../prisma/seed'

const NOW = new Date('2026-09-10T10:00:00Z')

const base = { buyerName: 'מיכל אברהמי', buyerPhone: '0527418830', pickupDate: utcDate(2026, 9, 15), pickupSlot: PickupSlot.AFTERNOON }

async function openShop() {
  await seed()
  await db.settings.update({ where: { id: 1 }, data: { bitPhone: '0500000000' } })
}

describe('reserveItems', () => {
  beforeEach(async () => {
    await resetDb()
    await openShop()
  })

  it('reserves every item and creates the order', async () => {
    const a = await makeItem({ priceAgorot: 85000 })
    const b = await makeItem({ priceAgorot: 45000 })

    const r = await reserveItems({ ...base, itemIds: [a.id, b.id] }, NOW)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.totalAgorot).toBe(130000)
    expect(r.code).toMatch(/^YS-\d{4}$/)
    expect(r.holdExpiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000))

    const items = await db.item.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(items.every((i) => i.status === ItemStatus.RESERVED)).toBe(true)
  })

  it('snapshots the price onto the order line', async () => {
    const a = await makeItem({ priceAgorot: 85000 })
    const r = await reserveItems({ ...base, itemIds: [a.id] }, NOW)
    if (!r.ok) throw new Error('expected ok')

    await db.item.update({ where: { id: a.id }, data: { priceAgorot: 1 } })
    const line = await db.orderItem.findFirstOrThrow({ where: { itemId: a.id } })
    expect(line.priceAgorot).toBe(85000)
  })

  it('reserves nothing when one item is already taken', async () => {
    const free = await makeItem()
    const taken = await makeItem({ status: ItemStatus.RESERVED })

    const r = await reserveItems({ ...base, itemIds: [free.id, taken.id] }, NOW)

    expect(r).toEqual({ ok: false, reason: 'UNAVAILABLE', unavailableItemIds: [taken.id] })
    expect((await db.item.findUniqueOrThrow({ where: { id: free.id } })).status).toBe(ItemStatus.AVAILABLE)
    expect(await db.order.count()).toBe(0)
  })

  it('will not sell an item the seller has hidden, even with its id in hand', async () => {
    // The buyer's own storefront never offers a hidden item, but a stale cart
    // or an old checkout link still carries the id.
    const hidden = await makeItem({ status: ItemStatus.HIDDEN })

    const r = await reserveItems({ ...base, itemIds: [hidden.id] }, NOW)

    expect(r).toEqual({ ok: false, reason: 'UNAVAILABLE', unavailableItemIds: [hidden.id] })
    expect((await db.item.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe(ItemStatus.HIDDEN)
    expect(await db.order.count()).toBe(0)
  })

  it('treats a sold item as unavailable', async () => {
    const sold = await makeItem({ status: ItemStatus.SOLD })
    const r = await reserveItems({ ...base, itemIds: [sold.id] }, NOW)
    expect(r).toMatchObject({ ok: false, reason: 'UNAVAILABLE' })
  })

  it('lets only one of two simultaneous checkouts win', async () => {
    const item = await makeItem()

    const [first, second] = await Promise.all([
      reserveItems({ ...base, itemIds: [item.id] }, NOW),
      reserveItems({ ...base, itemIds: [item.id] }, NOW),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect(await db.order.count()).toBe(1)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  it('sweeps an expired hold first, so its item can be reserved again', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:00:00Z') })

    const r = await reserveItems({ ...base, itemIds: [item.id] }, NOW)

    expect(r.ok).toBe(true)
    expect(await db.order.count({ where: { status: OrderStatus.EXPIRED } })).toBe(1)
  })

  it('rejects a pickup date outside the shared window', async () => {
    const a = await makeItem()
    const r = await reserveItems({ ...base, itemIds: [a.id], pickupDate: utcDate(2026, 9, 25) }, NOW)
    expect(r).toEqual({ ok: false, reason: 'BAD_PICKUP_DATE' })
    expect(await db.order.count()).toBe(0)
  })

  it('rejects an empty cart', async () => {
    expect(await reserveItems({ ...base, itemIds: [] }, NOW)).toEqual({ ok: false, reason: 'EMPTY_CART' })
  })

  // Checkout is unauthenticated and item ids are public, so an uncapped order
  // lets one caller hold the whole shop RESERVED for a full hold window.
  it('refuses an order larger than the per-order cap, reserving nothing', async () => {
    const items = []
    for (let i = 0; i < MAX_ITEMS_PER_ORDER + 1; i++) items.push(await makeItem())

    const r = await reserveItems({ ...base, itemIds: items.map((i) => i.id) }, NOW)

    expect(r).toEqual({ ok: false, reason: 'TOO_MANY_ITEMS' })
    expect(await db.order.count()).toBe(0)
    expect(await db.item.count({ where: { status: ItemStatus.RESERVED } })).toBe(0)
  })

  it('counts the cap after de-duplicating, so a repeated id is not a bigger order', async () => {
    const item = await makeItem()
    const r = await reserveItems({ ...base, itemIds: Array(MAX_ITEMS_PER_ORDER + 5).fill(item.id) }, NOW)
    expect(r.ok).toBe(true)
  })

  it('refuses to take orders while the BIT number is unset', async () => {
    await db.settings.update({ where: { id: 1 }, data: { bitPhone: '' } })
    const a = await makeItem()
    expect(await reserveItems({ ...base, itemIds: [a.id] }, NOW)).toEqual({ ok: false, reason: 'SHOP_NOT_OPEN' })
    expect(await db.order.count()).toBe(0)
  })

  // Regression for the double-sell in sweep.ts: two buyers racing to reserve an item
  // held by the same stale, expired hold. Each reserveItems call sweeps the expired
  // order itself before claiming, so the sweep's own read-then-write must not be able
  // to steal an item back from whichever checkout wins the race.
  it('lets only one of two simultaneous checkouts win an item held by an expired hold', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:00:00Z') })

    const [first, second] = await Promise.all([
      reserveItems({ ...base, itemIds: [item.id] }, NOW),
      reserveItems({ ...base, itemIds: [item.id] }, NOW),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)

    const liveHolds = await db.orderItem.count({
      where: {
        itemId: item.id,
        order: { status: { in: [OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID] } },
      },
    })
    expect(liveHolds).toBe(1)

    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })
})
