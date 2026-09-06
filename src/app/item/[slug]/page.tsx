import { notFound } from 'next/navigation'
import { getPublicItem } from '@/lib/items'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { decodeSlugParam } from '@/lib/slug'
import { SiteHeader } from '@/components/SiteHeader'
import { ItemDetail } from '@/components/ItemDetail'

/**
 * The standalone, shareable item page. Also what the `@modal` intercepting
 * route falls back to on a hard navigation (a refresh, or opening the link
 * directly) — Next only intercepts a soft, same-origin navigation.
 */
export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // A hard navigation lands here without passing the grid, so unlike the
  // `@modal` route this page is not preceded by `/`'s sweep — see
  // src/app/page.tsx. With no scheduler, an availability read that opens with
  // no sweep shows a lapsed hold as if it still held the item.
  await releaseExpiredHolds()

  const [item, settings] = await Promise.all([getPublicItem(decodeSlugParam(slug)), getSettings()])
  if (!item) notFound()

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />
      <div className="wrap item-page">
        {/* Exactly the fields ItemDetail declares. Passing the whole Settings
            row typechecks, but this is a client component: Next serialises
            every field it is handed into the RSC payload, which would put the
            seller's private bitPhone on every public item page. */}
        <ItemDetail item={item} settings={{ addressLine: settings.addressLine, city: settings.city }} />
      </div>
    </>
  )
}
