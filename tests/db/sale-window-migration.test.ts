import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { utcDate } from '@/lib/dates'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder, makeSettings } from '../helpers/factories'

/**
 * The one-off data fix in prisma/migrations/20260915100000_sale_window_to_28_sep.
 *
 * It runs once on a deploy and can never be run again, so this reproduces its
 * SQL verbatim rather than importing it. That is a real cost — the two can
 * drift, and after the deploy nothing will notice — but the alternative is
 * shipping an UPDATE across every row of a live shop with no evidence that its
 * `NOT EXISTS` does what its comment claims. This codebase has already shipped
 * one predicate that was NULL where it meant true.
 */
const FIX = `
UPDATE "Item" i
SET "pickupFrom" = DATE '2026-09-15', "pickupTo" = DATE '2026-09-28'
WHERE i."status" <> 'RESERVED'
  AND NOT EXISTS (
    SELECT 1
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE oi."itemId" = i."id"
      AND o."status" IN ('PENDING_PAYMENT', 'CLAIMED_PAID', 'PAID')
  )`

const SETTINGS_FIX = `UPDATE "Settings" SET "saleFrom" = DATE '2026-09-15', "saleTo" = DATE '2026-09-28' WHERE "id" = 1`

const windowOf = async (id: string) => {
  const item = await db.item.findUniqueOrThrow({ where: { id } })
  return { from: item.pickupFrom, to: item.pickupTo }
}

const FIXED = { from: utcDate(2026, 9, 15), to: utcDate(2026, 9, 28) }

describe('the 28 September data fix', () => {
  beforeEach(resetDb)

  it('moves an ordinary item onto the new window', async () => {
    const item = await makeItem()
    await db.$executeRawUnsafe(FIX)
    expect(await windowOf(item.id)).toEqual(FIXED)
  })

  it('moves an item that has NO orders at all', async () => {
    // The whole reason this is NOT EXISTS over a join. `"orderId" <> …` is
    // NULL for an item with no order row, and NULL is not true, so every
    // untouched item in the shop would have been skipped — which is most of
    // them, and the failure would have been silent.
    const item = await makeItem()
    expect(await db.orderItem.count({ where: { itemId: item.id } })).toBe(0)

    await db.$executeRawUnsafe(FIX)
    expect(await windowOf(item.id)).toEqual(FIXED)
  })

  it('leaves a RESERVED item on the dates its buyer was shown', async () => {
    const held = await makeItem({ status: ItemStatus.RESERVED })
    const before = await windowOf(held.id)

    await db.$executeRawUnsafe(FIX)
    expect(await windowOf(held.id)).toEqual(before)
  })

  it.each([OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID])(
    'leaves an item carried by a %s order alone',
    async (status) => {
      const item = await makeItem()
      await makeOrder([item.id], { status })
      const before = await windowOf(item.id)

      await db.$executeRawUnsafe(FIX)
      expect(await windowOf(item.id)).toEqual(before)
    },
  )

  it.each([OrderStatus.CANCELLED, OrderStatus.EXPIRED])(
    'moves an item whose only order is %s — that claim is released',
    async (status) => {
      const item = await makeItem()
      await makeOrder([item.id], { status })

      await db.$executeRawUnsafe(FIX)
      expect(await windowOf(item.id)).toEqual(FIXED)
    },
  )

  it('agrees with the admin action it mirrors, on the same shop', async () => {
    // Two implementations of one rule — this SQL and `HELD_BY_LIVE_ORDER` —
    // and the seller can run either. They must not disagree about which items
    // are safe to move.
    const free = await makeItem()
    const reserved = await makeItem({ status: ItemStatus.RESERVED })
    const ordered = await makeItem()
    await makeOrder([ordered.id], { status: OrderStatus.PAID })
    const cancelled = await makeItem()
    await makeOrder([cancelled.id], { status: OrderStatus.CANCELLED })

    const moved = await db.$executeRawUnsafe(FIX)

    expect(moved).toBe(2)
    expect(await windowOf(free.id)).toEqual(FIXED)
    expect(await windowOf(cancelled.id)).toEqual(FIXED)
    expect((await windowOf(reserved.id)).from).not.toEqual(FIXED.from)
    expect((await windowOf(ordered.id)).from).not.toEqual(FIXED.from)
  })

  it('sets the window new items will open with', async () => {
    await makeSettings()
    await db.$executeRawUnsafe(SETTINGS_FIX)

    const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.saleFrom).toEqual(FIXED.from)
    expect(settings.saleTo).toEqual(FIXED.to)
  })

  it('does nothing on a database with no Settings row yet', async () => {
    // A fresh install runs migrations before the seed. This must not fail, and
    // must not conjure a row whose dates nobody chose.
    expect(await db.$executeRawUnsafe(SETTINGS_FIX)).toBe(0)
    expect(await db.settings.count()).toBe(0)
  })
})
