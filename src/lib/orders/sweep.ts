import { ItemStatus, OrderStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { db as defaultDb } from '@/lib/db'

type PrismaLike = PrismaClient | Prisma.TransactionClient

/**
 * Releases every PENDING_PAYMENT order whose hold has elapsed, and returns their items
 * to the shop. Called at the head of every path that reads or changes availability, which
 * is why the project needs no scheduler. Returns how many orders were expired.
 *
 * CLAIMED_PAID orders are deliberately untouched: once the buyer says they paid, the
 * clock stops and only the seller resolves the order.
 */
export async function releaseExpiredHolds(client: PrismaLike = defaultDb, now: Date = new Date()): Promise<number> {
  // Prisma has no nested transactions, so only wrap when handed a plain client.
  // The wrap is not dressing: it is what makes the order-first ordering below safe.
  if ('$transaction' in client) return client.$transaction((tx) => sweep(tx, now))
  return sweep(client, now)
}

async function sweep(tx: Prisma.TransactionClient, now: Date): Promise<number> {
  const candidates = await tx.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, holdExpiresAt: { lt: now } },
    select: { id: true, items: { select: { itemId: true } } },
  })
  if (candidates.length === 0) return 0

  let expiredCount = 0
  for (const order of candidates) {
    // The order row is the mutex. This UPDATE blocks on any concurrent transaction
    // holding the row, then re-evaluates its WHERE against the committed tuple. If a
    // concurrent sweep already expired this order, we affect 0 rows and must NOT touch
    // its items: by then they may legitimately belong to someone else's new order.
    // The status guard also stops a buyer who tapped "paid" mid-sweep from being expired.
    const won = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.PENDING_PAYMENT, holdExpiresAt: { lt: now } },
      data: { status: OrderStatus.EXPIRED, holdExpiresAt: null },
    })
    if (won.count === 0) continue

    await tx.item.updateMany({
      where: { id: { in: order.items.map((i) => i.itemId) }, status: ItemStatus.RESERVED },
      data: { status: ItemStatus.AVAILABLE },
    })
    expiredCount++
  }
  return expiredCount
}
