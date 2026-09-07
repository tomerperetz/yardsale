import Link from 'next/link'
import { getPublicItemsByIds } from '@/lib/items'
import { getSettings, shopIsOpen } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { photoUrl } from '@/lib/photo-url'
import { intersectPickupWindows } from '@/lib/dates'
import { SiteHeader } from '@/components/SiteHeader'
import { Price } from '@/components/Price'
import { PickupWindow } from '@/components/PickupWindow'
import { CheckoutForm } from '@/components/CheckoutForm'

/**
 * Server component: reads the cart ids the cart page wrote into the query
 * string, re-fetches the items (never trusting client-held price/status),
 * and computes the shared pickup-window intersection. When the intersection
 * is empty it names the two conflicting items instead of just failing, and
 * offers to check out without one of them — see `intersectPickupWindows`.
 */
/** Never prerendered, for the same reason as the shop — see src/app/page.tsx. */
export const dynamic = 'force-dynamic'

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // This page filters on status === 'AVAILABLE', so without the sweep a
  // lapsed hold nobody owns makes a free item vanish behind "אין פריטים
  // זמינים לתשלום" — see src/app/page.tsx for why every read path opens here.
  await releaseExpiredHolds()

  const params = await searchParams
  const itemsParam = params.items
  const requestedIds = [...new Set((Array.isArray(itemsParam) ? itemsParam[0] : itemsParam ?? '').split(',').filter(Boolean))]

  const [found, settings] = await Promise.all([
    requestedIds.length > 0 ? getPublicItemsByIds(requestedIds) : Promise.resolve([]),
    getSettings(),
  ])

  const items = found.filter((item) => item.status === 'AVAILABLE')
  const open = shopIsOpen(settings)
  const totalAgorot = items.reduce((sum, item) => sum + item.priceAgorot, 0)

  const intersection =
    items.length > 0
      ? intersectPickupWindows(
          items.map((item) => ({ id: item.id, from: item.pickupFrom, to: item.pickupTo })),
          new Date(),
        )
      : null

  const startItem = intersection ? items.find((item) => item.id === intersection.startItemId) : undefined
  const endItem = intersection ? items.find((item) => item.id === intersection.endItemId) : undefined

  const withoutItem = (id: string) => {
    const remaining = items.filter((item) => item.id !== id).map((item) => item.id)
    return remaining.length > 0 ? `/checkout?items=${remaining.join(',')}` : '/cart'
  }

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />
      <div className="wrap checkout-page">
        <div className="checkout-card">
          <h2>פרטים ואיסוף</h2>

          {items.length === 0 ? (
            <p className="empty-cart">
              אין פריטים זמינים לתשלום. <Link href="/cart">חזרה לסל</Link>
            </p>
          ) : !open ? (
            <p className="closed-note">החנות עדיין לא פתוחה להזמנות</p>
          ) : intersection && !intersection.ok ? (
            <div className="conflict">
              <p className="window-note">
                אי אפשר לבחור יום איסוף אחד שמתאים לכל הפריטים בהזמנה: את &quot;<b>{endItem?.name}</b>&quot; אפשר
                לאסוף רק עד <b>{endItem && <PickupWindow from={endItem.pickupTo} to={endItem.pickupTo} />}</b>, ואילו
                &quot;<b>{startItem?.name}</b>&quot; אפשר לאסוף רק החל מ־
                <b>{startItem && <PickupWindow from={startItem.pickupFrom} to={startItem.pickupFrom} />}</b>.
              </p>
              {startItem && endItem && (
                <div className="split-actions">
                  <Link className="btn-primary" href={withoutItem(startItem.id)}>
                    המשך בלי &quot;{startItem.name}&quot;
                  </Link>
                  <Link className="btn-primary" href={withoutItem(endItem.id)}>
                    המשך בלי &quot;{endItem.name}&quot;
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="cart-lines">
                {items.map((item) => {
                  const photo = item.photos[0]
                  return (
                    <div key={item.id} className="mini">
                      {photo && <img src={photoUrl(photo.id)} alt="" />}
                      <span className="n">{item.name}</span>
                      <Price agorot={item.priceAgorot} className="p" />
                    </div>
                  )
                })}
              </div>
              <div className="total">
                <span>{items.length} פריטים</span>
                <Price agorot={totalAgorot} className="total-price" />
              </div>

              {intersection && intersection.ok && (
                <CheckoutForm
                  itemIds={items.map((item) => item.id)}
                  pickupItems={items.map((item) => ({ id: item.id, name: item.name, from: item.pickupFrom, to: item.pickupTo }))}
                  intersection={intersection}
                  slotHours={{ MORNING: settings.slotMorning, AFTERNOON: settings.slotAfternoon, EVENING: settings.slotEvening }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
