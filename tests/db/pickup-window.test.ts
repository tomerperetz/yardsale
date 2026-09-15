import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { setPickupWindowForAll, pickupWindowCounts, validatePickupWindow } from '@/lib/admin/items'
import { utcDate } from '@/lib/dates'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'

const FROM = '2026-09-15'
const TO = '2026-09-28'

async function windowOf(id: string) {
  const item = await db.item.findUniqueOrThrow({ where: { id } })
  return { from: item.pickupFrom, to: item.pickupTo }
}

describe('validatePickupWindow', () => {
  it('reads two date inputs into the UTC midnights the columns hold', () => {
    expect(validatePickupWindow(FROM, TO)).toEqual({ from: utcDate(2026, 9, 15), to: utcDate(2026, 9, 28) })
  })

  it('refuses a window that ends before it starts', () => {
    expect(validatePickupWindow(TO, FROM)).toEqual({ error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.' })
  })

  it('refuses a missing end rather than filling it in', () => {
    expect(validatePickupWindow(FROM, '')).toEqual({ error: 'חלון איסוף לא תקין.' })
    expect(validatePickupWindow('', TO)).toEqual({ error: 'חלון איסוף לא תקין.' })
  })

  it('accepts a single-day window', () => {
    expect(validatePickupWindow(FROM, FROM)).toEqual({ from: utcDate(2026, 9, 15), to: utcDate(2026, 9, 15) })
  })
})

describe('setPickupWindowForAll', () => {
  beforeEach(resetDb)

  it('moves every item the shop is free to move', async () => {
    const a = await makeItem()
    const b = await makeItem({ status: ItemStatus.HIDDEN })
    const c = await makeItem({ status: ItemStatus.DRAFT })

    const result = await setPickupWindowForAll(FROM, TO)

    expect(result).toEqual({ ok: true, updated: 3, skipped: 0 })
    for (const id of [a.id, b.id, c.id]) {
      expect(await windowOf(id)).toEqual({ from: utcDate(2026, 9, 15), to: utcDate(2026, 9, 28) })
    }
  })

  it('leaves a RESERVED item on the dates its buyer was shown', async () => {
    // The order recorded a pickupDate inside the window that buyer saw. Moving
    // the item under them would leave the shop promising one thing and the
    // order saying another.
    const free = await makeItem()
    const held = await makeItem({ status: ItemStatus.RESERVED })
    const before = await windowOf(held.id)

    const result = await setPickupWindowForAll(FROM, TO)

    expect(result).toEqual({ ok: true, updated: 1, skipped: 1 })
    expect(await windowOf(held.id)).toEqual(before)
    expect((await windowOf(free.id)).from).toEqual(utcDate(2026, 9, 15))
  })

  it.each([OrderStatus.PENDING_PAYMENT, OrderStatus.CLAIMED_PAID, OrderStatus.PAID])(
    'leaves an item carried by a %s order alone',
    async (status) => {
      const item = await makeItem()
      await makeOrder([item.id], { status })
      const before = await windowOf(item.id)

      expect(await setPickupWindowForAll(FROM, TO)).toEqual({ ok: true, updated: 0, skipped: 1 })
      expect(await windowOf(item.id)).toEqual(before)
    },
  )

  it.each([OrderStatus.CANCELLED, OrderStatus.EXPIRED])(
    'moves an item whose only order is %s — that claim is released',
    async (status) => {
      // The regression this guards: `NOT` over a relation filter is NOT EXISTS,
      // which is true for an item with no live order. A column comparison here
      // would be NULL for an item with no order at all and drop the lot.
      const item = await makeItem()
      await makeOrder([item.id], { status })

      expect(await setPickupWindowForAll(FROM, TO)).toEqual({ ok: true, updated: 1, skipped: 0 })
      expect((await windowOf(item.id)).to).toEqual(utcDate(2026, 9, 28))
    },
  )

  it('moves a SOLD item — its order is done and its window is only history', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    expect(await setPickupWindowForAll(FROM, TO)).toEqual({ ok: true, updated: 1, skipped: 0 })
  })

  it('changes nothing when the window is invalid', async () => {
    const item = await makeItem()
    const before = await windowOf(item.id)

    expect(await setPickupWindowForAll(TO, FROM)).toEqual({
      ok: false,
      error: 'חלון האיסוף מסתיים לפני שהוא מתחיל.',
    })
    expect(await windowOf(item.id)).toEqual(before)
  })

  it('reports zero rather than failing on an empty shop', async () => {
    expect(await setPickupWindowForAll(FROM, TO)).toEqual({ ok: true, updated: 0, skipped: 0 })
  })
})

describe('pickupWindowCounts', () => {
  beforeEach(resetDb)

  it('splits the shop into what would move and what would not', async () => {
    await makeItem()
    await makeItem({ status: ItemStatus.HIDDEN })
    await makeItem({ status: ItemStatus.RESERVED })
    const ordered = await makeItem()
    await makeOrder([ordered.id], { status: OrderStatus.PAID })

    expect(await pickupWindowCounts()).toEqual({ movable: 2, held: 2 })
  })

  it('counts an item held twice over only once', async () => {
    // RESERVED *and* on a live order is the normal state mid-hold; the two
    // arms of HELD_BY_LIVE_ORDER are an OR, not a sum.
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id], { status: OrderStatus.PENDING_PAYMENT })

    expect(await pickupWindowCounts()).toEqual({ movable: 0, held: 1 })
  })

  it('predicts exactly what the update then does', async () => {
    await makeItem()
    await makeItem({ status: ItemStatus.RESERVED })
    await makeItem({ status: ItemStatus.DRAFT })

    const counts = await pickupWindowCounts()
    const result = await setPickupWindowForAll(FROM, TO)

    expect(result).toEqual({ ok: true, updated: counts.movable, skipped: counts.held })
  })
})
