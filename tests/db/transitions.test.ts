import { describe, it, expect, beforeEach } from 'vitest'
import { ItemStatus, OrderStatus, PickupSlot } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/db'
import { makeItem, makeOrder } from '../helpers/factories'
import { cancelOrder, claimPaid, confirmPayment } from '@/lib/orders/transitions'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { reserveItems } from '@/lib/orders/reserve'
import { utcDate } from '@/lib/dates'
import { seed } from '../../prisma/seed'

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

  it('refuses to cancel an order that is already dead', async () => {
    const item = await makeItem({ status: ItemStatus.AVAILABLE })
    const order = await makeOrder([item.id], { status: OrderStatus.CANCELLED, holdExpiresAt: null })
    expect(await cancelOrder(order.id)).toEqual({ ok: false, reason: 'ILLEGAL' })
  })
})

/**
 * The seller undoing a sale they had already confirmed (spec §6). Unlike the
 * other two cancellations this one moves items OUT of SOLD and takes a
 * completed sale off the books, so each consequence is asserted on its own:
 * the items, the money, and what the order may still do afterwards.
 */
describe('cancelOrder on an order already confirmed as paid', () => {
  beforeEach(resetDb)

  it('puts every sold item back on the shop', async () => {
    const a = await makeItem({ status: ItemStatus.SOLD })
    const b = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([a.id, b.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    expect(await cancelOrder(order.id, NOW)).toEqual({ ok: true })

    const items = await db.item.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(items.every((i) => i.status === ItemStatus.AVAILABLE)).toBe(true)
  })

  // The refund the seller now owes exists nowhere in the schema; these two
  // stamps together are the whole record that money came in and has to go
  // back out, and /admin/orders reads them to say so.
  it('keeps the confirmation stamp beside the cancellation one', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })
    await db.order.update({ where: { id: order.id }, data: { confirmedAt: new Date('2026-09-09T08:00:00Z') } })

    await cancelOrder(order.id, NOW)

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe(OrderStatus.CANCELLED)
    expect(after.confirmedAt).toEqual(new Date('2026-09-09T08:00:00Z'))
    expect(after.cancelledAt).toEqual(NOW)
  })

  // What /admin/orders shows the seller: the "שולם עד עכשיו" tile sums PAID
  // orders and the "פריטים נמכרו" tile counts SOLD items (page.tsx). A
  // cancelled sale has to leave both, or the seller is looking at money they
  // gave back and items they no longer sold.
  it('drops out of the paid total and the sold-item count', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD, priceAgorot: 42000 })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    const before = await db.order.aggregate({ where: { status: OrderStatus.PAID }, _sum: { totalAgorot: true } })
    expect(before._sum.totalAgorot).toBe(42000)
    expect(await db.item.count({ where: { status: ItemStatus.SOLD } })).toBe(1)

    await cancelOrder(order.id, NOW)

    const after = await db.order.aggregate({ where: { status: OrderStatus.PAID }, _sum: { totalAgorot: true } })
    expect(after._sum.totalAgorot).toBeNull()
    expect(await db.item.count({ where: { status: ItemStatus.SOLD } })).toBe(0)
  })

  // The point of the whole feature: the item is on the shop again, and the
  // shop's own atomic claim will hand it to the next buyer.
  it('leaves the items buyable again through a real checkout', async () => {
    // reserveItems refuses outright until the shop is open for business —
    // same two lines as tests/db/reserve.test.ts's openShop().
    await seed()
    await db.settings.update({ where: { id: 1 }, data: { bitPhone: '0500000000' } })

    const item = await makeItem({ status: ItemStatus.SOLD, priceAgorot: 42000 })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    await cancelOrder(order.id, NOW)

    const next = await reserveItems(
      {
        itemIds: [item.id],
        buyerName: 'קונה שני',
        buyerPhone: '0527418830',
        pickupDate: utcDate(2026, 9, 15),
        pickupSlot: PickupSlot.AFTERNOON,
      },
      NOW,
    )
    expect(next.ok).toBe(true)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
  })

  // CANCELLED is terminal in both directions: the seller cannot un-cancel by
  // pressing "אישור תשלום" again, which would re-sell items another buyer may
  // by now be holding.
  it('cannot then be confirmed back into a sale', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    await cancelOrder(order.id, NOW)

    expect(await confirmPayment(order.id)).toEqual({ ok: false, reason: 'ILLEGAL' })
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(after.status).toBe(OrderStatus.CANCELLED)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.AVAILABLE)
  })

  it('refuses a second cancellation rather than releasing the items twice', async () => {
    const item = await makeItem({ status: ItemStatus.SOLD })
    const order = await makeOrder([item.id], { status: OrderStatus.PAID, holdExpiresAt: null })

    expect(await cancelOrder(order.id, NOW)).toEqual({ ok: true })
    // Someone else's checkout takes the freed item, exactly as reserveItems would.
    await db.item.update({ where: { id: item.id }, data: { status: ItemStatus.RESERVED } })

    expect(await cancelOrder(order.id, NOW)).toEqual({ ok: false, reason: 'ILLEGAL' })
    // The second cancellation must not drag the item out of the new buyer's hold.
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.RESERVED)
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

  /**
   * Two tabs of the same orders screen, one pressing "אישור תשלום" and the
   * other "ביטול". Both validated against CLAIMED_PAID, and each wants the
   * items in a different place. Either may win — and since a paid order can
   * now be cancelled too, a cancel whose own read landed after the
   * confirmation committed is simply the feature working — but the order and
   * its items must end up telling the same story.
   */
  it('never leaves a confirm and a cancel disagreeing about the items', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { status: OrderStatus.CLAIMED_PAID, holdExpiresAt: null })

    await Promise.all([confirmPayment(order.id, NOW), cancelOrder(order.id, NOW)])

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } })
    const itemAfter = await db.item.findUniqueOrThrow({ where: { id: item.id } })

    expect([OrderStatus.PAID, OrderStatus.CANCELLED]).toContain(after.status)
    expect(itemAfter.status).toBe(after.status === OrderStatus.PAID ? ItemStatus.SOLD : ItemStatus.AVAILABLE)
  })

  /**
   * The same pair, interleaved rather than hoped for: the cancel has already
   * read CLAIMED_PAID and validated against it when the confirmation commits.
   * Its own write must then find nothing to update and touch no item — a
   * cancel that went ahead here would put an item the seller has just been
   * paid for back on the shop while the order says PAID.
   *
   * The confirmation is spelled out rather than calling confirmPayment,
   * which opens a transaction of its own that cannot be joined to this lock.
   */
  it('declines to release the items once a confirmation has landed underneath it', async () => {
    const item = await makeItem({ status: ItemStatus.RESERVED })
    const order = await makeOrder([item.id], { status: OrderStatus.CLAIMED_PAID, holdExpiresAt: null })

    const confirmer = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`
      await sleep(300)
      await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.CLAIMED_PAID },
        data: { status: OrderStatus.PAID, confirmedAt: NOW },
      })
      await tx.item.updateMany({
        where: { id: item.id, status: ItemStatus.RESERVED },
        data: { status: ItemStatus.SOLD },
      })
    })
    const cancel = sleep(100).then(() => cancelOrder(order.id, NOW))

    const [, result] = await Promise.all([confirmer, cancel])

    expect(result).toEqual({ ok: false, reason: 'ILLEGAL' })
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.PAID)
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(ItemStatus.SOLD)
  })
})
