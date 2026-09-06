import { ItemStatus, OrderStatus, type PickupSlot, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { newOrderCode, newOrderToken } from '@/lib/orders/codes'
import { eachDay, intersectPickupWindows, startOfUtcDay } from '@/lib/dates'

export type ReserveInput = {
  itemIds: string[]
  buyerName: string
  buyerPhone: string
  pickupDate: Date
  pickupSlot: PickupSlot
}

export type ReserveResult =
  | { ok: true; code: string; token: string; totalAgorot: number; holdExpiresAt: Date }
  | { ok: false; reason: 'EMPTY_CART' }
  | { ok: false; reason: 'UNAVAILABLE'; unavailableItemIds: string[] }
  | { ok: false; reason: 'BAD_PICKUP_DATE' }
  | { ok: false; reason: 'SHOP_NOT_OPEN' }

class Abort extends Error {
  constructor(readonly result: ReserveResult) {
    super('reserve aborted')
  }
}

export async function reserveItems(input: ReserveInput, now: Date = new Date()): Promise<ReserveResult> {
  const itemIds = [...new Set(input.itemIds)]
  if (itemIds.length === 0) return { ok: false, reason: 'EMPTY_CART' }

  try {
    return await db.$transaction(async (tx) => {
      const settings = await tx.settings.findUnique({ where: { id: 1 } })
      if (!settings || settings.bitPhone.trim() === '') throw new Abort({ ok: false, reason: 'SHOP_NOT_OPEN' })

      await releaseExpiredHolds(tx, now)

      // Which of the requested items are actually free? This read must happen
      // BEFORE the UPDATE below: afterwards, rows this transaction just reserved
      // are indistinguishable from rows another buyer already held.
      const free = await tx.item.findMany({
        where: { id: { in: itemIds }, status: ItemStatus.AVAILABLE },
        select: { id: true },
      })
      const freeIds = new Set(free.map((i) => i.id))
      const taken = itemIds.filter((id) => !freeIds.has(id))
      if (taken.length > 0) {
        throw new Abort({ ok: false, reason: 'UNAVAILABLE', unavailableItemIds: taken })
      }

      // The concurrency guarantee, unchanged: one conditional UPDATE. If it did
      // not touch every requested row, a concurrent checkout won the race between
      // the read above and this statement, so roll back.
      const claimed = await tx.item.updateMany({
        where: { id: { in: itemIds }, status: ItemStatus.AVAILABLE },
        data: { status: ItemStatus.RESERVED },
      })
      if (claimed.count !== itemIds.length) {
        throw new Abort({ ok: false, reason: 'UNAVAILABLE', unavailableItemIds: itemIds })
      }

      const items = await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, priceAgorot: true, pickupFrom: true, pickupTo: true },
      })

      const overlap = intersectPickupWindows(
        items.map((i) => ({ id: i.id, from: i.pickupFrom, to: i.pickupTo })),
        now,
      )
      const wanted = startOfUtcDay(input.pickupDate).getTime()
      const legal = overlap.ok && eachDay(overlap.from, overlap.to).some((d) => d.getTime() === wanted)
      if (!legal) throw new Abort({ ok: false, reason: 'BAD_PICKUP_DATE' })

      const totalAgorot = items.reduce((sum, i) => sum + i.priceAgorot, 0)
      const holdExpiresAt = new Date(now.getTime() + settings.holdMinutes * 60_000)

      const order = await createOrderWithUniqueCode(tx, {
        buyerName: input.buyerName.trim(),
        buyerPhone: input.buyerPhone.trim(),
        pickupDate: startOfUtcDay(input.pickupDate),
        pickupSlot: input.pickupSlot,
        totalAgorot,
        holdExpiresAt,
        lines: items.map((i) => ({ itemId: i.id, priceAgorot: i.priceAgorot })),
      })

      return { ok: true as const, code: order.code, token: order.token, totalAgorot, holdExpiresAt }
    })
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

type NewOrder = {
  buyerName: string
  buyerPhone: string
  pickupDate: Date
  pickupSlot: PickupSlot
  totalAgorot: number
  holdExpiresAt: Date
  lines: { itemId: string; priceAgorot: number }[]
}

/** `code` is only 4 digits, so collisions happen; retry a few times before giving up. */
async function createOrderWithUniqueCode(tx: Prisma.TransactionClient, data: NewOrder) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tx.order.create({
        data: {
          code: newOrderCode(),
          token: newOrderToken(),
          buyerName: data.buyerName,
          buyerPhone: data.buyerPhone,
          status: OrderStatus.PENDING_PAYMENT,
          pickupDate: data.pickupDate,
          pickupSlot: data.pickupSlot,
          totalAgorot: data.totalAgorot,
          holdExpiresAt: data.holdExpiresAt,
          items: { create: data.lines },
        },
      })
    } catch (e) {
      const isDuplicate = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      if (!isDuplicate || attempt === 4) throw e
    }
  }
  throw new Error('unreachable')
}
