import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { cancelOrder, claimPaid, confirmPayment } from '@/lib/orders/transitions'

const NOW = new Date('2026-09-10T10:00:00Z')

describe('claimPaid', () => {
  beforeEach(resetDb)

  it('stops the clock and moves the order to claimed', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T10:10:00Z') })

    expect(await claimPaid(order.token, NOW)).toEqual({ ok: true })

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe(OrderStatus.CLAIMED_PAID)
    expect(after.holdExpiresAt).toBeNull()
    expect(after.claimedAt).not.toBeNull()
  })

  it('leaves the items reserved, not sold', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T10:10:00Z') })
    await claimPaid(order.token, NOW)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  it('refuses once the hold has already lapsed', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:00:00Z') })
    expect(await claimPaid(order.token, NOW)).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('is idempotent enough to survive a double tap', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T10:10:00Z') })
    await claimPaid(order.token, NOW)
    expect(await claimPaid(order.token, NOW)).toEqual({ ok: false, reason: 'ILLEGAL' })
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.CLAIMED_PAID)
  })

  it('reports an unknown token', async () => {
    expect(await claimPaid('nope', NOW)).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})

describe('confirmPayment', () => {
  beforeEach(resetDb)

  it('sells every item on the order', async () => {
    const a = await makeItem({ status: ItemStatus.RESERVED })
    const b = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([a.id, b.id], { status: OrderStatus.CLAIMED_PAID, holdExpiresAt: null })

    expect(await confirmPayment(order.id)).toEqual({ ok: true })

    const items = await db.item.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(items.every((i) => i.status === ItemStatus.SOLD)).toBe(true)
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmedAt).not.toBeNull()
  })

  it('refuses to confirm an order the buyer has not claimed', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id])
    expect(await confirmPayment(order.id)).toEqual({ ok: false, reason: 'ILLEGAL' })
  })
})

describe('cancelOrder', () => {
  beforeEach(resetDb)

  it('returns the items to the shop', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { status: OrderStatus.CLAIMED_PAID, holdExpiresAt: null })

    expect(await cancelOrder(order.id)).toEqual({ ok: true })
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.AVAILABLE)
  })

  it('refuses to cancel a paid order', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })
    expect(await cancelOrder(order.id)).toEqual({ ok: false, reason: 'ILLEGAL' })
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.SOLD)
  })
})
