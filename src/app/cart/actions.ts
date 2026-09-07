'use server'

import type { ItemStatus } from '@prisma/client'
import { getPublicItemsByIds } from '@/lib/items'
import { getSettings, shopIsOpen } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { photoUrl } from '@/lib/photo-url'

export type CartLine = {
  id: string
  slug: string
  name: string
  priceAgorot: number
  status: ItemStatus
  photoUrl: string | null
}

/**
 * The cart itself only holds ids in the buyer's browser — this re-fetches
 * every item on each visit, so a cart left open overnight shows today's
 * price and availability, not what it was when the item was added. It also
 * hands back the shop's name/tagline, since this is a client page and can't
 * read `getSettings()` directly for the header.
 */
export async function getCartData(
  ids: string[],
): Promise<{ items: CartLine[]; shopOpen: boolean; shopName: string; tagline: string }> {
  // The cart reads each item's live status to show "נתפס", so it is an
  // availability read like any other and opens with the sweep — otherwise a
  // lapsed hold marks an item taken when nobody owns it. See src/app/page.tsx.
  await releaseExpiredHolds()

  const uniqueIds = [...new Set(ids)]

  const [found, settings] = await Promise.all([
    uniqueIds.length > 0 ? getPublicItemsByIds(uniqueIds) : Promise.resolve([]),
    getSettings(),
  ])

  const byId = new Map(found.map((item) => [item.id, item]))
  // Preserve the cart's own order, not whatever order the DB returned.
  const items: CartLine[] = uniqueIds.flatMap((id) => {
    const item = byId.get(id)
    if (!item) return []
    const photo = item.photos[0]
    return [
      {
        id: item.id,
        slug: item.slug,
        name: item.name,
        priceAgorot: item.priceAgorot,
        status: item.status,
        photoUrl: photo ? photoUrl(photo.id) : null,
      },
    ]
  })

  return { items, shopOpen: shopIsOpen(settings), shopName: settings.shopName, tagline: settings.tagline }
}
