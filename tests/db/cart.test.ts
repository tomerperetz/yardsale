import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { getCartData } from '@/app/cart/actions'

/**
 * The cart shows each item's live status, so it is an availability read and
 * has to open with the sweep like every other one — there is no scheduler.
 * Without it a hold that lapsed hours ago still marks the item "נתפס" and the
 * buyer cannot check out something nobody owns.
 */
describe('getCartData', () => {
  beforeEach(resetDb)

  it('releases a lapsed hold, so a free item reads as available', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date(Date.now() - 60_000) })

    const { items } = await getCartData([item.id])

    expect(items).toHaveLength(1)
    expect(items[0].status).toBe(ItemStatus.AVAILABLE)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.EXPIRED)
  })

  it('leaves an item held by a live hold marked as taken', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    await makeOrder([item.id], { holdExpiresAt: new Date(Date.now() + 600_000) })

    const { items } = await getCartData([item.id])

    expect(items[0].status).toBe(ItemStatus.RESERVED)
  })
})
