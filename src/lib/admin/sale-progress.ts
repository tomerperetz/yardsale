import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * How far through the sale the seller is, in the two numbers they actually
 * asked for: how much of the stuff has gone, and how much of the money.
 *
 * Both are measured over the same set of items, and that set is the whole
 * argument. A DRAFT is a photograph nobody has priced or published — counting
 * it would make the shop look emptier the more the seller imports, and it
 * would drag the money bar down by an item carrying a price of zero. A HIDDEN
 * item is one deliberately withheld from the shop; it is not for sale today
 * and is not part of what today's sale can earn. What is left — AVAILABLE,
 * RESERVED, SOLD — is exactly the inventory a buyer could put money on.
 *
 * Both sides of the money bar are the ITEM's own price, not the order's. The
 * order records what was actually charged and would be the right number for
 * accounting; this is not accounting. It is "how much of what I put out has
 * turned into money", and asking that question with two different prices on
 * the two sides of the fraction would let the bar exceed 100% after a price
 * change.
 */

/** The inventory this sale consists of. Drafts are not for sale; hidden items are not for sale today. */
const COUNTED: ItemStatus[] = [ItemStatus.AVAILABLE, ItemStatus.RESERVED, ItemStatus.SOLD]

export type SaleProgress = {
  itemsSold: number
  itemsTotal: number
  soldAgorot: number
  potentialAgorot: number
}

export async function saleProgress(): Promise<SaleProgress> {
  const [all, sold] = await Promise.all([
    db.item.aggregate({ where: { status: { in: COUNTED } }, _count: { _all: true }, _sum: { priceAgorot: true } }),
    db.item.aggregate({ where: { status: ItemStatus.SOLD }, _count: { _all: true }, _sum: { priceAgorot: true } }),
  ])

  return {
    itemsSold: sold._count._all,
    itemsTotal: all._count._all,
    // `_sum` is null, not 0, when the aggregate matched no rows at all.
    soldAgorot: sold._sum.priceAgorot ?? 0,
    potentialAgorot: all._sum.priceAgorot ?? 0,
  }
}

/**
 * A whole-number percentage, and 0 for a shop with nothing in it.
 *
 * Rounded rather than floored, but never rounded up to 100 while something is
 * still unsold: a bar reading "100%" over a shop with two items left on the
 * shelf is the one number here that would actually mislead. The same guard in
 * reverse keeps a first sale visible instead of rounding it away to 0%.
 */
export function percent(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0
  if (part >= whole) return 100
  return Math.min(99, Math.max(1, Math.round((part / whole) * 100)))
}
