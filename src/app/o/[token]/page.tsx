import { notFound } from 'next/navigation'
import { OrderStatus, PickupSlot } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { SiteHeader } from '@/components/SiteHeader'
import { Price } from '@/components/Price'
import { PickupWindow } from '@/components/PickupWindow'

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'ממתין לתשלום',
  CLAIMED_PAID: 'ממתין לאישור',
  PAID: 'שולם',
  EXPIRED: 'פג תוקף',
  CANCELLED: 'בוטל',
}

// Purely a styling hook — the visible label above is what carries meaning.
const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'pending',
  CLAIMED_PAID: 'claimed',
  PAID: 'paid',
  EXPIRED: 'over',
  CANCELLED: 'over',
}

const SLOT_LABEL: Record<PickupSlot, string> = {
  MORNING: 'בוקר',
  AFTERNOON: 'אחה״צ',
  EVENING: 'ערב',
}

/**
 * The order's own page: what was bought, the total, when and roughly
 * where to pick it up, and the order's current status in plain Hebrew.
 * Read-only — nothing here changes the order's state. Linked to from the
 * payment page once the buyer has declared payment, and meant to be
 * revisited (e.g. from the WhatsApp confirmation) at any later point.
 */
export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Same reasoning as /pay/[token] and every other read path (see
  // src/app/page.tsx): sweep lapsed holds before reading status, or a
  // buyer could see a stale "ממתין לתשלום" for a hold that already lapsed.
  await releaseExpiredHolds()

  const [order, settings] = await Promise.all([
    db.order.findUnique({
      where: { token },
      include: {
        items: { include: { item: { include: { photos: { orderBy: { position: 'asc' }, take: 1 } } } } },
      },
    }),
    getSettings(),
  ])
  if (!order) notFound()

  const address = [settings.addressLine, settings.city].filter((s) => s.trim() !== '').join(', ')

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />
      <div className="wrap order-page">
        <div className="order-card">
          <h2>הזמנה {order.code}</h2>
          <span className={`status-pill status-${STATUS_CLASS[order.status]}`}>{STATUS_LABEL[order.status]}</span>

          <div className="cart-lines">
            {order.items.map((line) => {
              const photo = line.item.photos[0]
              return (
                <div key={line.id} className="mini">
                  {photo && <img src={`/img/${line.item.id}/${photo.id}-400.webp`} alt="" />}
                  <span className="n">{line.item.name}</span>
                  <Price agorot={line.priceAgorot} className="p" />
                </div>
              )
            })}
          </div>
          <div className="total">
            <span>{order.items.length} פריטים</span>
            <Price agorot={order.totalAgorot} className="total-price" />
          </div>

          <div className="facts">
            <div className="fact">
              <i>◷</i>
              <span>
                איסוף ב<b><PickupWindow from={order.pickupDate} to={order.pickupDate} /></b> · {SLOT_LABEL[order.pickupSlot]}
              </span>
            </div>
            {address !== '' && (
              <div className="fact">
                <i>◎</i>
                <span>{address}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
