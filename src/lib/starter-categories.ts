/**
 * The categories a shop starts with.
 *
 * They exist because the first thing the AI import is asked to do is pick a
 * category "from the seller's own list", and a brand-new shop has no list: the
 * model proposed one per item and the shop drifted into a set nobody chose —
 * כללי beside ספורט beside ילדים והריון, each holding two or three things and
 * each hiding the others' items behind its own chip in the buyer's filter bar.
 * Five plain names, present before the first photograph, give the model
 * something to choose instead of something to invent.
 *
 * Seeding them is safe on a shop that already has items: an empty category is
 * invisible to buyers (`getPublicCategories` lists only categories with a
 * public item), and one that already exists by name is left exactly as it is.
 * Names that merely overlap with an existing one — ציוד ספורט arriving beside
 * a ספורט the seller already had — are the categories screen's job, which
 * already offers to merge them.
 *
 * The same five are inserted by prisma/migrations/…_starter_categories, which
 * is the only path that reaches a deployed database: `npm start` runs
 * `prisma migrate deploy`, never the seed. Change one, change the other.
 */
export const STARTER_CATEGORIES = ['ריהוט', 'אלקטרוניקה', 'ילדים', 'הריון ולידה', 'ציוד ספורט'] as const
