import { notFound } from 'next/navigation'
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

  return (
    <QuickLookModal titleId={`item-name-${item.slug}`}>
      <ItemDetail item={item} settings={settings} />
    </QuickLookModal>
  )
}
