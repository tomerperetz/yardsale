import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { cancelOrder, claimPaid, confirmPayment } from '@/lib/orders/transitions'
import { releaseExpiredHolds } from '@/lib/orders/sweep'

const NOW = new Date('2026-09-10T10:00:00Z')

// One hold, seen from either side of its last second.
const HOLD_ENDS = new Date('2026-09-10T10:00:00Z')
const CLAIM_NOW = new Date('2026-09-10T09:59:59Z')
const SWEEP_NOW = new Date('2026-09-10T10:00:01Z')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

  // The sweep nulls holdExpiresAt when it expires an order, so the hold guard
  // above cannot see this case: only the order's own status can. Reporting it
  // as ILLEGAL made /pay/[token] tell the buyer "we already have your message"
  // — reassuring and false — while the items were back on sale.
  it('reports an already-swept order as EXPIRED, not ILLEGAL', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:00:00Z') })

    await releaseExpiredHolds(db, NOW)

    expect(await claimPaid(order.token, NOW)).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  // Claiming payment is an order-only state change: the items are already
  // RESERVED and must stay exactly as they are. An unconditional write here
  // is what could force an item back out of another buyer's order, so prove
  // no row is written at all rather than just that the status looks right.
  it('writes to no item row at all', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T10:10:00Z') })
    const before = await db.item.findUniqueOrThrow({ where: { id: item.id } })

    expect(await claimPaid(order.token, NOW)).toEqual({ ok: true })

    const after = await db.item.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.status).toBe(ItemStatus.RESERVED)
    expect(after.updatedAt).toEqual(before.updatedAt)
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

/**
 * Every item here is one-of-a-kind, so a transition that validates against a
 * stale pre-image and then writes anyway is a double-sell. `move()` reads the
 * order without a lock, so its write has to re-assert the status it validated
 * — and when it loses that race it must touch no item, because those items can
 * by then belong to a different buyer.
 */
describe('a transition racing another change to the same order', () => {
  beforeEach(resetDb)

  it('leaves a third buyer holding the item when the claim arrives too late', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const late = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:00:00Z') })

    // The hold lapses and someone else's checkout sweeps it...
    await releaseExpiredHolds(db, NOW)
    // ...and takes the item, exactly as reserveItems would.
    await db.item.update({ where: { id: item.id }, data: { status: ItemStatus.RESERVED } })
    const winner = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T10:10:00Z') })

    expect(await claimPaid(late.token, NOW)).toEqual({ ok: false, reason: 'EXPIRED' })

    expect((await db.order.findUniqueOrThrow({ where: { id: late.id } })).status).toBe(OrderStatus.EXPIRED)
    expect((await db.order.findUniqueOrThrow({ where: { id: winner.id } })).status).toBe(OrderStatus.PENDING_PAYMENT)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  it('keeps the order and its item consistent when a claim and a sweep run at once', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: new Date('2026-09-10T09:59:59Z') })

    await Promise.all([claimPaid(order.token, NOW), releaseExpiredHolds(db, NOW)])

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    const itemAfter = await db.item.findUniqueOrThrow({ where: { id: item.id } })

    // Either outcome is fine; a mixture is not. An EXPIRED order whose item is
    // still RESERVED strands the item; a CLAIMED_PAID order whose item went
    // back to AVAILABLE sells it to someone else under a paying buyer.
    expect([OrderStatus.CLAIMED_PAID, OrderStatus.EXPIRED]).toContain(after.status)
    expect(itemAfter.status).toBe(
      after.status === OrderStatus.CLAIMED_PAID ? ItemStatus.RESERVED : ItemStatus.AVAILABLE,
    )
  })

  /**
   * The interleaving itself, forced rather than hoped for. A buyer taps
   * "שילמתי בביט" in the last second of the hold (CLAIM_NOW is before the
   * hold ends, so the hold guard lets them through) while another buyer's
   * checkout sweeps the same order a moment later (SWEEP_NOW is after it).
   *
   * Holding the order row in a separate transaction pins the claim exactly
   * where the bug lived: it has already read PENDING_PAYMENT and validated
   * against it, and is blocked on its own write. Whatever it does after the
   * sweep commits is decided entirely by the write's own guard.
   */
  it('declines to write once the order has moved underneath it', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { holdExpiresAt: HOLD_ENDS })

    const sweeper = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`
      await sleep(300)
      return releaseExpiredHolds(tx, SWEEP_NOW)
    })
    const claim = sleep(100).then(() => claimPaid(order.token, CLAIM_NOW))

    const [swept, result] = await Promise.all([sweeper, claim])

    expect(swept).toBe(1)
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' })
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.EXPIRED)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.AVAILABLE)
  })
})
