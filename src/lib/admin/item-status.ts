/**
 * The item statuses a seller may set by hand.
 *
 * Plain string literals in an import-free module, for the same reason
 * src/lib/admin/draft.ts exists: the edit screen is a client component, and
 * reaching into admin/items.ts for these would drag Prisma and `sharp` into
 * the browser bundle. admin/items.ts asserts at compile time that every value
 * here is a real `ItemStatus`, so the two cannot drift.
 *
 * The two that are missing are missing on purpose. `RESERVED` belongs to the
 * order flow, which owns that transition in both directions. `DRAFT` is what
 * `HIDDEN` exists to avoid: `updateItem` regenerates a draft's slug on every
 * save, so unpublishing through DRAFT would let the next rename recycle a URL
 * buyers have already shared. A HIDDEN item keeps its slug, so unhiding
 * restores the link people already have.
 */
export const SELLABLE_STATUSES = ['AVAILABLE', 'HIDDEN', 'SOLD'] as const

export type SellableStatus = (typeof SELLABLE_STATUSES)[number]
