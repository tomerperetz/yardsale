import { db } from '@/lib/db'
import { publicItemWhere } from '@/lib/visibility'

/** Sold items stay visible in this shop — see spec §7; see `publicItemWhere` for what isn't. */
export async function getPublicItem(slug: string) {
  return db.item.findFirst({
    where: { slug, ...publicItemWhere },
    include: { category: true, photos: { orderBy: { position: 'asc' } } },
  })
}

/**
 * The categories worth offering a buyer as a filter: only those something
 * public actually sits in.
 *
 * Categories accumulate on their own — the entry form needs one for the draft
 * it opens and falls back to "כללי", and deleting a category's last item
 * leaves the category behind. Listing them all put chips in the filter bar
 * that lead to an empty grid.
 */
export async function getPublicCategories() {
  return db.category.findMany({
    where: { items: { some: publicItemWhere } },
    orderBy: { name: 'asc' },
  })
}

export async function getPublicItemsByIds(ids: string[]) {
  return db.item.findMany({
    where: { id: { in: ids }, ...publicItemWhere },
    include: { category: true, photos: { orderBy: { position: 'asc' }, take: 1 } },
  })
}
