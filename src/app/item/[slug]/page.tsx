import type { Metadata } from 'next'
import { EventKind, ItemStatus } from '@prisma/client'
import { notFound } from 'next/navigation'
import { getPublicItem } from '@/lib/items'
import { formatAgorot } from '@/lib/money'
import { shareCard } from '@/lib/share-card'
import { record } from '@/lib/analytics/record'
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
 * A SOLD item still has a page — this shop keeps sold items in the grid,
 * dimmed, because a yard sale reads better when you can see what went (spec
 * §7) — so it still gets a card here. It says נמכר and drops the price. A link
 * forwarded into a group two hours after the sofa went would otherwise preview
 * as "ספה — ₪450" with a photograph, which is an advertisement for something
 * nobody can have, and the price is the half a buyer acts on.
 *
 * A DRAFT or HIDDEN item is not public at all: `getPublicItem` filters it out,
 * the page 404s, and this returns nothing, so the link previews bare.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const [item, settings] = await Promise.all([getPublicItem(decodeSlugParam(slug)), getSettings()])
  if (!item) return {}

  const cover = item.photos[0] ?? null
  const sold = item.status === ItemStatus.SOLD
  const price = formatAgorot(item.priceAgorot)

  return shareCard({
    title: sold ? `${item.name} — נמכר` : `${item.name} — ${price}`,
    // The seller's own description, and the category behind it when there is
    // no description yet — never a generated sentence about an item nobody has
    // described, which is how a preview ends up claiming something untrue.
    description: sold
      ? `הפריט הזה כבר נמכר. יש עוד דברים בחנות.`
      : item.description.trim() !== ''
        ? item.description
        : `${item.category.name} · ${price}`,
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

  // After the lookup, so a 404 is not counted as someone looking at an item,
  // and keyed on the id rather than the slug — a slug changes when the seller
  // renames the item, and the history should not fork when it does.
  await record(EventKind.VIEW_ITEM, item.id)

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
