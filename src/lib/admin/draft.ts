/**
 * The name an item carries before anyone has given it a real one.
 *
 * The import writes it and the import reads it back, which is what makes it a
 * shared constant rather than a string literal in two places. `clusterBatch`
 * and `movePhoto(photoId, 'new')` name every item they create with it, and
 * `ImportReview` compares against it to decide whether a card shows the
 * item's name or a "פריט 3" placeholder — so changing this text on one side
 * only would leave every imported card labelled with the placeholder name
 * itself, which is exactly the string it is meant to stand in for.
 *
 * Its own module, and deliberately free of imports, because `ImportReview` is
 * a client component: importing this from items.ts would drag Prisma and
 * `sharp` into the browser bundle — the same reason src/lib/photo-url.ts
 * exists.
 */
export const DRAFT_NAME = 'פריט חדש'
