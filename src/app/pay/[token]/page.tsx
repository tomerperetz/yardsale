import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { formatAgorot } from '@/lib/money'
import { holdIsRunning } from '@/lib/orders/state'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { SiteHeader } from '@/components/SiteHeader'
import { ClearOrderedFromCart } from '@/components/ClearOrderedFromCart'
import { HoldCountdown } from '@/components/HoldCountdown'
import { CopyField } from '@/components/CopyField'
import { PayForm } from './PayForm'

/**
 * The last screen a buyer sees before money moves. BIT has no merchant API
 * for a private seller, so the site can only hold the items for a short
 * window and tell the buyer exactly what to transfer, to whom, and with
 * what reference — the number, the exact amount, and the short code for
 * the transfer note.
 *
 * Styling lifted from docs/design/mockups/02-buyer-flow.html, panel 3
 * ("תשלום בביט").
 */
export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Same reasoning as every other read path in this app (see src/app/page.tsx):
  // there is no scheduler, so a lapsed hold only becomes EXPIRED in the
  // database when something reads it. Without this sweep, an order whose
  // hold elapsed a while ago would keep showing PENDING_PAYMENT here.
  await releaseExpiredHolds()

  const [order, settings] = await Promise.all([
    db.order.findUnique({
      where: { token },
      select: {
        token: true,
        code: true,
        status: true,
        totalAgorot: true,
        holdExpiresAt: true,
        // A cancelled order that carries one was cancelled after the seller
        // had the money — the difference between "you're owed a refund" and
        // "nothing happened", and the buyer reads that difference below.
        confirmedAt: true,
        items: { select: { itemId: true } },
      },
    }),
    getSettings(),
  ])
  if (!order) notFound()

  return (
    <>
      <SiteHeader shopName={settings.shopName} tagline={settings.tagline} />
      {/* The order exists, so these items are no longer things to shop for —
          leaving them in the cart shows the buyer their own items as "נתפס". */}
      <ClearOrderedFromCart itemIds={order.items.map((line) => line.itemId)} />
      <div className="wrap pay-page">
        <div className="pay-card">
          <h2>תשלום בביט</h2>

          {holdIsRunning(order.status) && order.holdExpiresAt ? (
            <>
              <HoldCountdown holdExpiresAt={order.holdExpiresAt} />

              {settings.bitPhone.trim() !== '' ? (
                <CopyField label="מספר לביט" value={settings.bitPhone} dir="ltr" />
              ) : (
                <p className="pay-note">מספר הביט של המוכר/ת עוד לא הוגדר — אי אפשר להעביר תשלום כרגע. נסו שוב בעוד כמה דקות.</p>
              )}
              <CopyField label="סכום מדויק" value={formatAgorot(order.totalAgorot)} />
              <CopyField label="הערה להעברה" value={order.code} dir="ltr" />

              <ol className="steps">
                <li>
                  <i>1</i>
                  <span>
                    פותחים ביט ומעבירים <b>{formatAgorot(order.totalAgorot)}</b> למספר שלמעלה.
                  </span>
                </li>
                <li>
                  <i>2</i>
                  <span>
                    רושמים <b>{order.code}</b> בהערה — ככה נדע שההעברה שלכם.
                  </span>
                </li>
                <li>
                  <i>3</i>
                  <span>
                    חוזרים לכאן ולוחצים <b>שילמתי בביט</b>.
                  </span>
                </li>
              </ol>

              <PayForm token={order.token} />
            </>
          ) : order.status === 'CLAIMED_PAID' ? (
            <div className="pay-waiting">
              <p>קיבלנו — ממתינים לאישור התשלום.</p>
              <Link className="btn-primary" href={`/o/${order.token}`}>
                לצפייה בהזמנה
              </Link>
            </div>
          ) : order.status === 'PAID' ? (
            <div className="pay-waiting">
              <p>התשלום אושר — ההזמנה שלכם מוכנה.</p>
              <Link className="btn-primary" href={`/o/${order.token}`}>
                לצפייה בהזמנה
              </Link>
            </div>
          ) : order.status === 'CANCELLED' ? (
            /* Cancelled is not expired, and this bookmark is where the buyer
               comes back to. Falling through to "ההזמנה פגה" told someone
               whose paid order the seller had just reversed that they had
               timed out — the one thing that did not happen. */
            <div className="pay-over">
              {order.confirmedAt ? (
                <>
                  <p>ההזמנה בוטלה אחרי שהתשלום אושר. המוכר/ת יחזרו אליכם לגבי ההחזר.</p>
                  <Link className="btn-primary" href={`/o/${order.token}`}>
                    לצפייה בהזמנה
                  </Link>
                </>
              ) : (
                <>
                  <p>ההזמנה בוטלה והפריטים חזרו למכירה.</p>
                  <Link className="btn-primary" href="/">
                    חזרה לחנות
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className="pay-over">
              <p>ההזמנה פגה.</p>
              <Link className="btn-primary" href="/">
                חזרה לחנות
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
