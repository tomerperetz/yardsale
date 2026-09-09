/**
 * How two category names are compared, with no imports of its own.
 *
 * Its own module for the same reason src/lib/admin/draft.ts and
 * src/lib/photo-url.ts are: the AI client needs to decide whether the name a
 * model proposed is genuinely new or is one the seller already has, and
 * reaching into admin/items.ts for that would drag Prisma and `sharp` along
 * behind it.
 */

/** Trims and collapses whitespace. The name as it will be stored. */
export function normalizeCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * The form two names are compared in, which is deliberately looser than the
 * stored form: it also drops a leading "ה". A seller who has `ריהוט` and is
 * offered `הריהוט` has not been offered a new category, and creating one would
 * put two chips in the buyer's filter bar that each hide the other's items.
 */
export function normalizeForCompare(name: string): string {
  return normalizeCategoryName(name).replace(/^ה/, '')
}
