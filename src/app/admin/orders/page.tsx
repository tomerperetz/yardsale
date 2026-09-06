import Link from 'next/link'
import { OrderStatus, PickupSlot } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { waLink, messageForOrder } from '@/lib/whatsapp'
import { Price } from '@/components/Price'
import { AdminNav } from '@/components/admin/AdminNav'
import { FirstRunChecklist } from '@/components/admin/FirstRunChecklist'
import { OrderCountdown } from '@/components/admin/OrderCountdown'
import { OrderRowActions } from './OrderRowActions'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './orders.module.css'

const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const SLOT_LABEL: Record<PickupSlot, string> = { MORNING: 'בוקר', AFTERNOON: 'אחה״צ', EVENING: 'ערב' }

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'ממתין לתשלום',
  CLAIMED_PAID: 'אמר ששילם',
  PAID: 'שולם',
  EXPIRED: 'פג תוקף',
  CANCELLED: 'בוטל',
}
const STATUS_PILL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'wait',
  CLAIMED_PAID: 'confirm',
  PAID: 'paid',
  EXPIRED: 'dead',
  CANCELLED: 'dead',
}

const TABS: { key: string; label: string; statuses: OrderStatus[] | null }[] = [
  { key: 'all', label: 'הכל', statuses: null },
  { key: 'claimed', label: 'ממתינות לאישור', statuses: [OrderStatus.CLAIMED_PAID] },
  { key: 'paid', label: 'שולמו', statuses: [OrderStatus.PAID] },
  { key: 'expired', label: 'פגו', statuses: [OrderStatus.EXPIRED, OrderStatus.CANCELLED] },
]

function pickupCell(order: { status: OrderStatus; pickupDate: Date; pickupSlot: PickupSlot }): string {
  if (order.status === 'EXPIRED' || order.status === 'CANCELLED') return '—'
  return `${WEEKDAY_LETTERS[order.pickupDate.getUTCDay()]} ${order.pickupDate.getUTCDate()} · ${SLOT_LABEL[order.pickupSlot]}`
}

/**
 * The screen the seller actually lives in during a sale. BIT has no
 * merchant API, so every order waits on the seller looking at their
 * banking app and pressing "אישור תשלום" here — the CLAIMED_PAID rows are
 * highlighted and counted in both the nav badge and the first stat tile
 * for exactly that reason.
 *
 * `releaseExpiredHolds()` runs before anything else is read, same as
 * every other read path in this app — otherwise a lapsed hold would keep
 * showing PENDING_PAYMENT here until something else happened to sweep it.
 */
// See src/app/admin/settings/page.tsx for why every admin page is forced
// dynamic. This one also reads `searchParams`, which already forces it —
// the export just makes the requirement explicit and future-proof.
export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await releaseExpiredHolds()

  const params = await searchParams
  const tabKey = typeof params.tab === 'string' ? params.tab : 'all'
  const activeTab = TABS.find((t) => t.key === tabKey) ?? TABS[0]

  const now = new Date()

  const [orders, settings, itemCount, categoryCount, claimedCount, pendingCount, paidTotal, soldItemCount] =
    await Promise.all([
      db.order.findMany({
        where: activeTab.statuses ? { status: { in: activeTab.statuses } } : undefined,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { item: { include: { photos: { orderBy: { position: 'asc' }, take: 1 } } } } } },
      }),
      getSettings(),
      db.item.count(),
      db.category.count(),
      db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
      db.order.count({ where: { status: OrderStatus.PENDING_PAYMENT } }),
      db.order.aggregate({ where: { status: OrderStatus.PAID }, _sum: { totalAgorot: true } }),
      db.item.count({ where: { status: 'SOLD' } }),
    ])

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>ניהול הזמנות</h1>
          </div>
          <Link href="/" className="btn btn-ghost">
            צפייה בחנות ↗
          </Link>
        </div>
      </header>

      <div className="wrap">
        <FirstRunChecklist settings={settings} />

        <div className={adminStyles.shell}>
          <AdminNav
            active="orders"
            itemCount={itemCount}
            ordersAlertCount={claimedCount}
            categoryCount={categoryCount}
          />

          <main>
            <div className={styles.stats}>
              <div className={`${styles.stat} ${styles.hot}`}>
                <b>{claimedCount}</b>
                <span>ממתינות לאישור שלכם</span>
              </div>
              <div className={styles.stat}>
                <b>{pendingCount}</b>
                <span>ממתינות לתשלום</span>
              </div>
              <div className={styles.stat}>
                <b>
                  <Price agorot={paidTotal._sum.totalAgorot ?? 0} />
                </b>
                <span>שולם עד עכשיו</span>
              </div>
              <div className={styles.stat}>
                <b>{soldItemCount}</b>
                <span>פריטים נמכרו</span>
              </div>
            </div>

            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הזמנות</h2>
              </div>
              <p className={styles.psub}>שורה כתומה מחכה לכם: הקונה אמר ששילם, ואתם מאשרים אחרי שראיתם את ההעברה בביט.</p>

              <div className={styles.tabs}>
                {TABS.map((tab) => (
                  <Link
                    key={tab.key}
                    href={tab.key === 'all' ? '/admin/orders' : `/admin/orders?tab=${tab.key}`}
                    className={tab.key === activeTab.key ? styles.on : undefined}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>

              {orders.length === 0 ? (
                <p className={styles.empty}>אין הזמנות בקטגוריה הזו.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>קוד</th>
                        <th>קונה</th>
                        <th>פריטים</th>
                        <th>סכום</th>
                        <th>איסוף</th>
                        <th>סטטוס</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => {
                        const message = messageForOrder(order, settings, now)
                        const waHref = waLink(order.buyerPhone, message)
                        return (
                          <tr key={order.id} className={order.status === 'CLAIMED_PAID' ? styles.new : undefined}>
                            <td data-label="קוד">
                              <span className={styles.code} dir="ltr">
                                {order.code}
                              </span>
                            </td>
                            <td data-label="קונה">
                              <span className={styles.who}>
                                <b>{order.buyerName}</b>
                                <small dir="ltr">{order.buyerPhone}</small>
                              </span>
                            </td>
                            <td data-label="פריטים">
                              <span className={styles.thumbs}>
                                {order.items.map((line) => {
                                  const photo = line.item.photos[0]
                                  return photo ? (
                                    <img key={line.id} src={`/img/${line.item.id}/${photo.id}-400.webp`} alt="" />
                                  ) : (
                                    <span key={line.id} aria-hidden="true" className={styles.thumbPlaceholder} />
                                  )
                                })}
                              </span>
                            </td>
                            <td data-label="סכום">
                              <Price agorot={order.totalAgorot} className={styles.amt} />
                            </td>
                            <td data-label="איסוף">{pickupCell(order)}</td>
                            <td data-label="סטטוס">
                              {order.status === 'PENDING_PAYMENT' && order.holdExpiresAt ? (
                                <span className={`${styles.pill} ${styles.wait}`}>
                                  ממתין לתשלום · <OrderCountdown holdExpiresAt={order.holdExpiresAt} />
                                </span>
                              ) : (
                                <span className={`${styles.pill} ${styles[STATUS_PILL[order.status]]}`}>
                                  {STATUS_LABEL[order.status]}
                                </span>
                              )}
                            </td>
                            <td data-label="">
                              <OrderRowActions
                                orderId={order.id}
                                token={order.token}
                                status={order.status}
                                waHref={waHref}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </main>
        </div>
      </div>
    </>
  )
}
