/**
 * The name an item carries before the seller has typed one.
 *
 * Its own module, and deliberately free of imports, because both sides need
 * it: `openDraft` in items.ts matches on it to decide whether a draft has
 * been touched, and the client-side entry form sends it when it opens one.
 * Importing it from items.ts would drag Prisma and `sharp` into the browser
 * bundle — the same reason src/lib/photo-url.ts exists.
 */
export const DRAFT_NAME = 'פריט חדש'
