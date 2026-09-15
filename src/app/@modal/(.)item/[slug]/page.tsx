import { EventKind } from '@prisma/client'
import { notFound } from 'next/navigation'
import { record } from '@/lib/analytics/record'
import { getPublicItem } from '@/lib/items'
import { getSettings } from '@/lib/settings'
import { decodeSlugParam } from '@/lib/slug'
import { ItemDetail } from '@/components/ItemDetail'
import { QuickLookModal } from '@/components/QuickLookModal'

/**
 * Intercepts `/item/[slug]` when the buyer navigates to it from within the
 * app (e.g. clicking a grid card) — it renders the same `ItemDetail` as
 * `src/app/item/[slug]/page.tsx`, but as an overlay over the grid instead of
 * replacing it. The URL still becomes `/item/<slug>`; a refresh or a direct
 * link bypasses this and renders the full page instead.
 */
export default async function ItemQuickLook({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [item, settings] = await Promise.all([getPublicItem(decodeSlugParam(slug)), getSettings()])
  if (!item) notFound()

  // The same event as the full page, because to a buyer it is the same act:
  // clicking a card from the grid renders this, and opening the link fresh
  // renders that. Counting only one of them would measure which route Next
  // chose rather than what anybody did.
  await record(EventKind.VIEW_ITEM, item.id)

  return (
    <QuickLookModal titleId={`item-name-${item.slug}`}>
      {/* Narrowed to the fields ItemDetail declares — see the note in
          src/app/item/[slug]/page.tsx. */}
      <ItemDetail item={item} settings={{ addressLine: settings.addressLine, city: settings.city }} />
    </QuickLookModal>
  )
}
