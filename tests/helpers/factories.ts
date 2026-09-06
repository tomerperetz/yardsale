import { db } from '@/lib/db'
import { ItemStatus, OrderStatus, PickupSlot } from '@prisma/client'
import { utcDate } from '@/lib/dates'

let n = 0
const uniq = () => `${Date.now()}-${n++}`

export async function makeCategory(name = `cat-${uniq()}`) {
  return db.category.create({ data: { name, slug: name } })
}

export async function makeItem(overrides: Partial<{ status: ItemStatus; priceAgorot: number; categoryId: string }> = {}) {
  const categoryId = overrides.categoryId ?? (await makeCategory()).id
  const s = uniq()
  return db.item.create({
    data: {
      slug: `item-${s}`,
      name: `פריט ${s}`,
      description: 'תיאור',
      priceAgorot: overrides.priceAgorot ?? 10000,
      categoryId,
      pickupFrom: utcDate(2026, 9, 12),
      pickupTo: utcDate(2026, 9, 18),
      status: overrides.status ?? ItemStatus.AVAILABLE,
    },
  })
}

export async function makeOrder(itemIds: string[], overrides: Partial<{ status: OrderStatus; holdExpiresAt: Date | null }> = {}) {
  const items = await db.item.findMany({ where: { id: { in: itemIds } } })
  return db.order.create({
    data: {
      code: `YS-${1000 + n++}`,
      token: `tok-${uniq()}`,
      buyerName: 'קונה',
      buyerPhone: '0500000000',
      status: overrides.status ?? OrderStatus.PENDING_PAYMENT,
      pickupDate: utcDate(2026, 9, 15),
      pickupSlot: PickupSlot.AFTERNOON,
      totalAgorot: items.reduce((sum, i) => sum + i.priceAgorot, 0),
      holdExpiresAt: overrides.holdExpiresAt === undefined ? new Date(Date.now() + 900_000) : overrides.holdExpiresAt,
      items: { create: items.map((i) => ({ itemId: i.id, priceAgorot: i.priceAgorot })) },
    },
  })
}
