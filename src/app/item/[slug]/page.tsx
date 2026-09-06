import { notFound } from 'next/navigation'
import { getPublicItem } from '@/lib/items'
import { getSettings } from '@/lib/settings'
import { SiteHeader } from '@/components/SiteHeader'
import { ItemDetail } from '@/components/ItemDetail'

/**
 * The standalone, shareable item page. Also what the `@modal` intercepting
 * route falls back to on a hard navigation (a refresh, or opening the link
 * directly) — Next only intercepts a soft, same-origin navigation.
 */
export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [item, settings] = await Promise.all([getPublicItem(slug), getSettings()])
  if (!item) notFound()

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />
      <div className="wrap item-page">
        <ItemDetail item={item} settings={settings} />
      </div>
    </>
  )
}
