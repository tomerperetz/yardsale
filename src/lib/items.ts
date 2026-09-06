import { ItemStatus } from '@prisma/client'
import { db } from '@/lib/db'

/** Sold items stay visible in this shop — see spec §7 — so only DRAFT is hidden. */
export async function getPublicItem(slug: string) {
  return db.item.findFirst({
    where: { slug, status: { not: ItemStatus.DRAFT } },
    include: { category: true, photos: { orderBy: { position: 'asc' } } },
  })
}

export async function getPublicItemsByIds(ids: string[]) {
  return db.item.findMany({
    where: { id: { in: ids }, status: { not: ItemStatus.DRAFT } },
    include: { category: true, photos: { orderBy: { position: 'asc' }, take: 1 } },
  })
}
