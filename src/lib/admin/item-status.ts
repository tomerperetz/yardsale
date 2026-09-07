/**
 * The item statuses a seller may set by hand.
 *
 * Plain string literals in an import-free module, for the same reason
 * src/lib/admin/draft.ts exists: the edit screen is a client component, and
 * reaching into admin/items.ts for these would drag Prisma and `sharp` into
 * the browser bundle. admin/items.ts asserts at compile time that every value
 * here is a real `ItemStatus`, so the two cannot drift.
 *
 * Why only these two: `RESERVED` belongs to the order flow, which owns that
 * transition in both directions, and `DRAFT` would let a republished item
 * recycle a URL buyers have already shared — see `setItemStatus`.
 */
export const SELLABLE_STATUSES = ['AVAILABLE', 'SOLD'] as const

export type SellableStatus = (typeof SELLABLE_STATUSES)[number]
