import { OrderStatus, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { canTransition, itemStatusForOrderStatus } from '@/lib/orders/state'

export type TransitionResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'ILLEGAL' | 'EXPIRED' }

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
    if (!canTransition(order.status, to)) return { ok: false, reason: 'ILLEGAL' }

    await tx.order.update({
      where: { id: order.id },
      data: { status: to, [stamp]: now, holdExpiresAt: null },
    })
    await tx.item.updateMany({
      where: { id: { in: order.items.map((i) => i.itemId) } },
      data: { status: itemStatusForOrderStatus(to) },
    })
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
