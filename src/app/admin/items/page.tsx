import Link from 'next/link'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { saleWindowEnded, saleWindowInputs } from '@/lib/sale-window'
import { pickupWindowCounts } from '@/lib/admin/items'
import { saleProgress } from '@/lib/admin/sale-progress'
import { rewriteCount } from '@/lib/import/rewrite'
import { aiEnabled } from '@/lib/ai/client'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { photoUrl } from '@/lib/photo-url'
import { BulkQueue } from '@/components/admin/BulkQueue'
import { ImportDrop } from '@/app/admin/items/import/ImportDrop'
import { PickupWindowBulk } from './PickupWindowBulk'
import { DescriptionsBulk } from './DescriptionsBulk'
import { ItemStatusCell } from './ItemStatusCell'
import { SaleProgress } from '@/components/admin/SaleProgress'
import { PickupWindow } from '@/components/PickupWindow'
import { Price } from '@/components/Price'
import { AdminNav } from '@/components/admin/AdminNav'
import { FirstRunChecklist } from '@/components/admin/FirstRunChecklist'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './items.module.css'

/**
 * The seller's item-entry screen: one drop zone for photos, plus the item
 * table below. Wrapped in the shared AdminNav shell (Task 19) — the orders
 * badge needs to be visible from wherever the seller happens to be, and item
 * entry is where they spend most of their time.
 *
 * There used to be a mode toggle here, between a single-item form and this
 * one. The shop's owner asked for it to go: dropping one photo is how you add
 * one item, so a second screen for that case was a choice the seller had to
 * make before they could start, and never a choice worth making. Both halves
 * of the toggle asked for the same photos.
 *
 * The category "carries forward" from the most recently created item (across
 * page loads, not just within one session) so a returning seller doesn't have
 * to re-pick it every visit — see `BulkQueue`, which is where it is typed.
 * The pickup window does NOT: it comes from the sale's collection window in
 * Settings (`saleWindow`), because a window inherited item-to-item is a window
 * nobody ever re-reads, and one stale week propagated from it into every
 * listing in the shop. The AI import asks for neither at drop time: its review
 * screen sets both across the whole batch at once.
 *
 * The same window, applied across the items that already exist, is
 * `PickupWindowBulk` below — the repair for the shop this change prevents.
 */
// See src/app/admin/settings/page.tsx for why every admin page is forced
// dynamic. This page no longer reads `searchParams` — the mode toggle was the
// only thing that did — so the export is now the only thing keeping it out of
// the static cache, where a stale item table would be actively wrong.
export const dynamic = 'force-dynamic'

export default async function AdminItemsPage() {
  await releaseExpiredHolds()

  const [items, categories, lastItem, settings, claimedCount, windowCounts, progress, describable] =
    await Promise.all([
    db.item.findMany({
      orderBy: { createdAt: 'desc' },
      include: { category: true, photos: { orderBy: { position: 'asc' } } },
    }),
    db.category.findMany({ orderBy: { name: 'asc' } }),
    db.item.findFirst({ orderBy: { createdAt: 'desc' }, include: { category: true } }),
    getSettings(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
    pickupWindowCounts(),
    saleProgress(),
    rewriteCount(),
  ])

  const initialCategory = lastItem?.category.name ?? categories[0]?.name ?? ''
  // The pickup window comes from the sale's own window, NOT from the last item
  // the seller made. Inheriting it item-to-item is what carried one week
  // forward until every listing in the shop pointed at days that had passed:
  // nothing in that chain ever asked again. Settings is one place to fix, and
  // an unset window falls back to today → today+14 rather than to the past.
  const sale = saleWindowInputs(settings)
  const categoryNames = categories.map((c) => c.name)
  // Read once per render on the server: a key added to the environment starts
  // working on the next page load, and its absence never reaches the browser
  // as a broken feature — the screen falls back to capture-time grouping.
  //
  // Branching HERE rather than inside BulkQueue, which is where this choice
  // used to live as an `aiEnabled` prop and an early return. The server is
  // what reads the key, so the server is what should pick; a client component
  // taking a flag purely to render a different component instead of itself is
  // indirection, and it forced that return to sit below every hook in the
  // file with a comment explaining why it could not move. (It does NOT save
  // the browser any JavaScript: both are statically imported, so Next puts
  // both in this page's chunk either way. Checked, not assumed.)
  const aiImport = aiEnabled()

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>ניהול פריטים</h1>
          </div>
          <Link href="/" className="btn btn-ghost">
            צפייה בחנות ↗
          </Link>
        </div>
      </header>

      <div className="wrap">
        <FirstRunChecklist settings={settings} />

        <div className={adminStyles.shell}>
          <AdminNav active="items" itemCount={items.length} ordersAlertCount={claimedCount} categoryCount={categories.length} />

          <main className={styles.shell}>
            {/* First on the screen because it is the first thing worth
                knowing on opening it: how much has gone, and how much of the
                money has come in. */}
            <SaleProgress progress={progress} />

            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הוספת פריטים</h2>
                {/* Only the capture-time queue actually carries the category
                    forward — it is where one is typed. The AI import sets it on
                    the review screen, across the batch, so promising it here
                    would be a promise about another screen. It says "category"
                    and not "fields" because the dates beside it no longer come
                    from the last item at all; they come from the sale window. */}
                {!aiImport && initialCategory !== '' && (
                  <span className="carry">הקטגוריה ממשיכה מהפריט הקודם</span>
                )}
              </div>
              {/* One item is one photo — said out loud, because this screen
                  replaced a form that used to be the obvious place for it. */}
              <p className={styles.psub}>
                {aiImport
                  ? 'גוררים את כל התמונות בבת אחת, או תמונה אחת לפריט אחד. נחלק אותן לפריטים, נכתוב לכל פריט שם ותיאור, ואתם מתקנים ומפרסמים ממסך אחד.'
                  : 'גוררים את כל התמונות בבת אחת, או תמונה אחת לפריט אחד. כל קבוצה נפתחת כפריט, ואתם יורדים בתור וממלאים רק את מה שמשתנה.'}
              </p>

              {aiImport ? (
                <ImportDrop />
              ) : (
                <BulkQueue
                  categories={categoryNames}
                  initialCategory={initialCategory}
                  initialPickupFrom={sale.from}
                  initialPickupTo={sale.to}
                />
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הפריטים שלי</h2>
              </div>
              {/* Above the table because it is about every row in it: one sale
                  window, applied across the shop. Hidden when there is nothing
                  to apply it to — on an empty shop the only thing worth saying
                  about the window is in Settings. */}
              {items.length > 0 && <DescriptionsBulk rewritable={describable} aiOn={aiImport} />}
              {items.length > 0 && (
                <PickupWindowBulk
                  movable={windowCounts.movable}
                  held={windowCounts.held}
                  initialFrom={sale.from}
                  initialTo={sale.to}
                  saleWindowEnded={saleWindowEnded(settings)}
                />
              )}
              {items.length === 0 ? (
                <p className={styles.empty}>עדיין לא נוספו פריטים.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>פריט</th>
                        <th>קטגוריה</th>
                        <th>מחיר</th>
                        <th>חלון איסוף</th>
                        <th>סטטוס</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const photo = item.photos[0]
                        return (
                          <tr key={item.id}>
                            <td data-label="פריט">
                              <span className={styles.it}>
                                {photo ? (
                                  <img src={photoUrl(photo.id)} alt="" />
                                ) : (
                                  <span
                                    aria-hidden
                                    style={{
                                      width: 42,
                                      height: 42,
                                      borderRadius: 11,
                                      background: '#EEE9E4',
                                      display: 'inline-block',
                                      flex: 'none',
                                    }}
                                  />
                                )}
                                <span>
                                  <b>{item.name}</b>
                                  <small>{item.photos.length} תמונות</small>
                                </span>
                              </span>
                            </td>
                            <td data-label="קטגוריה">{item.category.name}</td>
                            <td data-label="מחיר">
                              <Price agorot={item.priceAgorot} />
                            </td>
                            <td data-label="איסוף">
                              {item.status === 'SOLD' ? '—' : <PickupWindow from={item.pickupFrom} to={item.pickupTo} />}
                            </td>
                            <td data-label="סטטוס">
                              {/* The chip is the control: it used to be a
                                  label, and changing a status meant opening
                                  the item's own screen — twelve screens to
                                  reserve twelve things. */}
                              <ItemStatusCell id={item.id} status={item.status} name={item.name} />
                            </td>
                            <td>
                              <Link href={`/admin/items/${item.id}`} className={styles.rowbtn}>
                                עריכה
                              </Link>
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
