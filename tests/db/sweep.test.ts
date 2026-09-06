import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { releaseExpiredHolds } from '@/lib/orders/sweep'

const PAST = new Date('2026-09-06T09:00:00Z')
const NOW = new Date('2026-09-06T10:00:00Z')

describe('releaseExpiredHolds', () => {
  beforeEach(resetDb)

  it('expires a pending order past its hold and frees its items', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: PAST })

    const count = await releaseExpiredHolds(db, NOW)

    expect(count).toBe(1)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.EXPIRED)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.AVAILABLE)
  })

  it('leaves a pending order whose hold has not elapsed alone', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-06T10:05:00Z') })

    expect(await releaseExpiredHolds(db, NOW)).toBe(0)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.PENDING_PAYMENT)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  it('never expires an order the buyer has claimed paid, even with an old hold', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { status: OrderStatus.CLAIMED_PAID, holdExpiresAt: PAST })

    expect(await releaseExpiredHolds(db, NOW)).toBe(0)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.CLAIMED_PAID)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  it('never touches a sold item belonging to a paid order', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: PAST })

    await releaseExpiredHolds(db, NOW)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.SOLD)
  })

  it('frees every item on a multi-item order', async () => {
    const a = await makeItem({ status: ItemStatus.RESERVED })
    const b = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([a.id, b.id], { holdExpiresAt: PAST })

    await releaseExpiredHolds(db, NOW)
    const items = await db.item.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(items.every((i) => i.status === ItemStatus.AVAILABLE)).toBe(true)
  })

  it('is safe to run twice', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id], { holdExpiresAt: PAST })

    expect(await releaseExpiredHolds(db, NOW)).toBe(1)
    expect(await releaseExpiredHolds(db, NOW)).toBe(0)
  })

  // Candidates are ordered by id so every sweep takes its order-row locks in
  // the same sequence. Two sweeps taking the same locks in opposite orders
  // deadlock (40P01), and since the sweep runs inside reserveItems'
  // transaction the victim is a buyer whose checkout throws.
  it('survives several sweeps running at once over the same stale orders', async () => {
    for (let i = 0; i < 6; i++) {
      const item = await makeItem({ status: ItemStatus.RESERVED })
      await makeOrder([item.id], { holdExpiresAt: PAST })
    }

    const results = await Promise.all(Array.from({ length: 4 }, () => releaseExpiredHolds(db, NOW)))

    // Exactly one sweep expires each order; the rest find nothing left to do.
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(6)
    expect(await db.order.count({ where: { status: OrderStatus.EXPIRED } })).toBe(6)
    expect(await db.item.count({ where: { status: ItemStatus.RESERVED } })).toBe(0)
  })
})
