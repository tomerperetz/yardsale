import { ItemStatus, type Prisma } from '@prisma/client'

/**
 * Which items a buyer is allowed to see, in one place.
 *
 * This used to be the literal `status: { not: DRAFT }`, written out at five
 * separate call sites. Adding a second non-public status to five copies of a
 * predicate is exactly how one gets missed — and a missed one here does not
 * fail loudly, it quietly leaks an item the seller took off the shop.
 *
 * `SOLD` is deliberately absent: sold items stay in the grid, dimmed, because
 * a yard sale reads better when you can see what went (spec §7).
 */
export const NOT_PUBLIC_STATUSES = [ItemStatus.DRAFT, ItemStatus.HIDDEN] as const

/** `where` fragment selecting only items a buyer may see. */
export const publicItemWhere: Prisma.ItemWhereInput = {
  status: { notIn: [...NOT_PUBLIC_STATUSES] },
}
