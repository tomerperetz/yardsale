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
  const expired = await client.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, holdExpiresAt: { lt: now } },
    select: { id: true, items: { select: { itemId: true } } },
  })
  if (expired.length === 0) return 0

  const orderIds = expired.map((o) => o.id)
  const itemIds = expired.flatMap((o) => o.items.map((i) => i.itemId))

  // Items are released before the order is marked EXPIRED. If the process dies (or the
  // second call fails) in between, the order is still PENDING_PAYMENT with a past
  // holdExpiresAt, so the next sweep picks it up again — the item update is then a
  // harmless no-op since it's guarded on status: RESERVED. Doing it the other way round
  // would strand RESERVED items on an already-EXPIRED order that no sweep ever revisits.
  await client.item.updateMany({
    where: { id: { in: itemIds }, status: ItemStatus.RESERVED },
    data: { status: ItemStatus.AVAILABLE },
  })
  await client.order.updateMany({
    where: { id: { in: orderIds } },
    data: { status: OrderStatus.EXPIRED, holdExpiresAt: null },
  })

  return expired.length
}
