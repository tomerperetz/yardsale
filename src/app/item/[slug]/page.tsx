import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicItem } from '@/lib/items'
import { formatAgorot } from '@/lib/money'
import { shareCard } from '@/lib/share-card'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { decodeSlugParam } from '@/lib/slug'
import { SiteHeader } from '@/components/SiteHeader'
import { ItemDetail } from '@/components/ItemDetail'

/**
 * What this item looks like when its link is pasted into WhatsApp: its own
 * photograph, its name, and the price — which is the question every buyer
 * opens the link to answer, and the one thing a shared link never used to say.
 *
 * A sold or hidden item resolves to nothing here for the same reason the page
 * 404s: `getPublicItem` applies the public filter, so a link to something that
 * has gone previews as a plain link rather than advertising an item that is
 * no longer for sale.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const [item, settings] = await Promise.all([getPublicItem(decodeSlugParam(slug)), getSettings()])
  if (!item) return {}

  const cover = item.photos[0] ?? null

  return shareCard({
    title: `${item.name} — ${formatAgorot(item.priceAgorot)}`,
    // The seller's own description, and the category behind it when there is
    // no description yet — never a generated sentence about an item nobody has
    // described, which is how a preview ends up claiming something untrue.
    description: item.description.trim() !== '' ? item.description : `${item.category.name} · ${formatAgorot(item.priceAgorot)}`,
    photo: cover && { id: cover.id, width: cover.width, height: cover.height },
    path: `/item/${item.slug}`,
    // The shop's name, not the item's: og:site_name is what a preview prints
    // above the card as the place this came from.
    siteName: settings.shopName.trim() !== '' ? settings.shopName : undefined,
  })
}

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
