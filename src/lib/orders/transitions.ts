import { OrderStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { canTransition, itemStatusForOrderStatus } from '@/lib/orders/state'

export type TransitionResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'ILLEGAL' | 'EXPIRED' }

/**
 * Why a transition out of `from` is refused. An order the sweep already
 * released is not merely in the wrong state — the buyer needs to be told the
 * hold lapsed and the items went back on sale, not that we have their message.
 */
function refusal(from: OrderStatus): TransitionResult {
  return { ok: false, reason: from === OrderStatus.EXPIRED ? 'EXPIRED' : 'ILLEGAL' }
}

async function move(
  where: Prisma.OrderWhereUniqueInput,
  to: OrderStatus,
  stamp: 'claimedAt' | 'confirmedAt' | 'cancelledAt',
  now: Date,
  guard?: (order: { holdExpiresAt: Date | null }) => TransitionResult | null,
): Promise<TransitionResult> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where, select: { id: true, status: true, holdExpiresAt: true, items: { select: { itemId: true } } } })
    if (!order) return { ok: false, reason: 'NOT_FOUND' }

    const blocked = guard?.(order)
    if (blocked) return blocked
    if (!canTransition(order.status, to)) return refusal(order.status)

    // The order row IS the guard. READ COMMITTED lets a concurrent transition
    // validate against the same pre-image this one read, so the write must
    // re-assert the status it was validated against: the UPDATE blocks on any
    // transaction holding the row, then re-evaluates its WHERE against the
    // committed tuple. Losing the race means someone else moved the order —
    // and then no item may be touched, because by now those items can
    // legitimately belong to a different buyer's order.
    const won = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: to, [stamp]: now, holdExpiresAt: null },
    })
    if (won.count === 0) {
      const actual = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } })
      return actual ? refusal(actual.status) : { ok: false, reason: 'NOT_FOUND' }
    }

    // Item statuses come from the order's own before/after states, so the
    // rules stay in `itemStatusForOrderStatus` and are not restated here:
    //   PENDING_PAYMENT/CLAIMED_PAID -> PAID       RESERVED -> SOLD
    //   PENDING_PAYMENT/CLAIMED_PAID -> CANCELLED  RESERVED -> AVAILABLE
    //   PENDING_PAYMENT -> CLAIMED_PAID            RESERVED -> RESERVED, so no write
    // The last line matters most: claiming payment is an order-only change.
    // Writing RESERVED unconditionally there is what could drag an item back
    // out of a third buyer's order after this one was swept.
    const fromItemStatus = itemStatusForOrderStatus(order.status)
    const toItemStatus = itemStatusForOrderStatus(to)
    if (fromItemStatus !== toItemStatus) {
      await tx.item.updateMany({
        where: { id: { in: order.items.map((i) => i.itemId) }, status: fromItemStatus },
        data: { status: toItemStatus },
      })
    }
    return { ok: true }
  })
}

/** The buyer says the BIT is sent. This stops the 15-minute clock; it does NOT sell the items. */
export function claimPaid(token: string, now: Date = new Date()): Promise<TransitionResult> {
  return move({ token }, OrderStatus.CLAIMED_PAID, 'claimedAt', now, (o) =>
    o.holdExpiresAt && o.holdExpiresAt.getTime() < now.getTime() ? { ok: false, reason: 'EXPIRED' } : null,
  )
}

/** The seller has seen the transfer. Only now do the items become SOLD. */
export function confirmPayment(orderId: string, now: Date = new Date()): Promise<TransitionResult> {
  return move({ id: orderId }, OrderStatus.PAID, 'confirmedAt', now)
}

export function cancelOrder(orderId: string, now: Date = new Date()): Promise<TransitionResult> {
  return move({ id: orderId }, OrderStatus.CANCELLED, 'cancelledAt', now)
}
