import { notFound } from 'next/navigation'
import { OrderStatus, PickupSlot } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { photoUrl } from '@/lib/photo-url'
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

/** The seller's configured hour range for a slot — same fields `whatsapp.ts` reads. May be empty. */
function slotHoursFor(slot: PickupSlot, settings: { slotMorning: string; slotAfternoon: string; slotEvening: string }): string {
  switch (slot) {
    case 'MORNING':
      return settings.slotMorning
    case 'AFTERNOON':
      return settings.slotAfternoon
    case 'EVENING':
      return settings.slotEvening
  }
}

/**
 * "אחה״צ" alone, or "אחה״צ · 12:00–17:00" once the seller has configured that
 * slot's hours. The hours carry `dir="ltr"` for the same reason
 * `src/components/Range.tsx` exists: two LTR number runs around a neutral dash
 * are reordered by the bidi algorithm in this RTL page, and the buyer would be
 * told to collect between 17:00 and 12:00.
 */
function SlotDisplay({
  slot,
  settings,
}: {
  slot: PickupSlot
  settings: { slotMorning: string; slotAfternoon: string; slotEvening: string }
}) {
  const hours = slotHoursFor(slot, settings).trim()
  if (hours === '') return <>{SLOT_LABEL[slot]}</>
  return (
    <>
      {SLOT_LABEL[slot]} · <span dir="ltr">{hours}</span>
    </>
  )
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

          {/* "בוטל" alone leaves a buyer who paid ₪450 with no idea whether
              they are getting it back. Saying what happened is not a promise
              the site cannot keep — the refund is the seller's to make, by
              hand, and nothing here tracks it — so this says that it is
              coming from them, and says nothing at all about when. */}
          {order.status === 'CANCELLED' && (
            <p className="order-note">
              {order.confirmedAt
                ? 'ההזמנה בוטלה אחרי שהתשלום אושר. המוכר/ת יחזרו אליכם לגבי ההחזר.'
                : 'ההזמנה בוטלה והפריטים חזרו למכירה.'}
            </p>
          )}

          <div className="cart-lines">
            {order.items.map((line) => {
              const photo = line.item.photos[0]
              return (
                <div key={line.id} className="mini">
                  {photo && <img src={photoUrl(photo.id)} alt="" />}
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
                איסוף ב<b><PickupWindow from={order.pickupDate} to={order.pickupDate} /></b> · <SlotDisplay slot={order.pickupSlot} settings={settings} />
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
