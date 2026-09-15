/**
 * The item statuses a seller may set by hand.
 *
 * Plain string literals in an import-free module, for the same reason
 * src/lib/admin/draft.ts exists: the edit screen is a client component, and
 * reaching into admin/items.ts for these would drag Prisma and `sharp` into
 * the browser bundle. admin/items.ts asserts at compile time that every value
 * here is a real `ItemStatus`, so the two cannot drift.
 *
 * `RESERVED` is here as of 2026-09-15, and it is the one status with two
 * owners. The order flow sets it when a buyer holds an item and clears it when
 * the hold lapses — that claim is not the seller's to move, and `setItemStatus`
 * still refuses it. The seller sets the same status by hand for the other kind
 * of reservation this shop actually runs on: someone messaged saying they will
 * come on Friday for the washing machine. That is not sold, not hidden, and
 * not a fifteen-minute hold, and before this the only ways to say it were to
 * hide the item — breaking a link already shared — or to lie and mark it sold.
 *
 * The two are told apart by whether a live order holds the item, which is a
 * fact the database already has; nothing needs to record which of the two put
 * an item in this state.
 *
 * `DRAFT` is still missing, and on purpose: it is what `HIDDEN` exists to
 * avoid. `updateItem` regenerates a draft's slug on every save, so
 * unpublishing through DRAFT would let the next rename recycle a URL buyers
 * have already shared. A HIDDEN item keeps its slug, so unhiding restores the
 * link people already have.
 */
export const SELLABLE_STATUSES = ['AVAILABLE', 'RESERVED', 'HIDDEN', 'SOLD'] as const

export type SellableStatus = (typeof SELLABLE_STATUSES)[number]
