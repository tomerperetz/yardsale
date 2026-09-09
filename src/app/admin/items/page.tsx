import Link from 'next/link'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { aiEnabled } from '@/lib/ai/client'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { photoUrl } from '@/lib/photo-url'
import { BulkQueue } from '@/components/admin/BulkQueue'
import { ImportDrop } from '@/app/admin/items/import/ImportDrop'
import { PickupWindow } from '@/components/PickupWindow'
import { Price } from '@/components/Price'
import { AdminNav } from '@/components/admin/AdminNav'
import { FirstRunChecklist } from '@/components/admin/FirstRunChecklist'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './items.module.css'

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'זמין',
  RESERVED: 'שמור',
  SOLD: 'נמכר',
  DRAFT: 'טיוטה',
  HIDDEN: 'מוסתר',
}
const STATUS_CLASS: Record<string, string> = {
  AVAILABLE: 'ok',
  RESERVED: 'hold',
  SOLD: 'sold',
  DRAFT: 'draft',
  HIDDEN: 'hidden',
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

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
 * Category and pickup window "carry forward" from the most recently created
 * item (across page loads, not just within one session) so a returning seller
 * doesn't have to re-pick them every visit — see `BulkQueue`, which is where
 * they are typed. The AI import asks for neither at drop time: its review
 * screen sets both across the whole batch at once.
 */
// See src/app/admin/settings/page.tsx for why every admin page is forced
// dynamic. This page no longer reads `searchParams` — the mode toggle was the
// only thing that did — so the export is now the only thing keeping it out of
// the static cache, where a stale item table would be actively wrong.
export const dynamic = 'force-dynamic'

export default async function AdminItemsPage() {
  await releaseExpiredHolds()

  const [items, categories, lastItem, settings, claimedCount] = await Promise.all([
    db.item.findMany({
      orderBy: { createdAt: 'desc' },
      include: { category: true, photos: { orderBy: { position: 'asc' } } },
    }),
    db.category.findMany({ orderBy: { name: 'asc' } }),
    db.item.findFirst({ orderBy: { createdAt: 'desc' }, include: { category: true } }),
    getSettings(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
  ])

  const today = new Date()
  const inAWeek = new Date(today.getTime() + 6 * 86_400_000)

  const initialCategory = lastItem?.category.name ?? categories[0]?.name ?? ''
  const initialPickupFrom = lastItem ? toDateInput(lastItem.pickupFrom) : toDateInput(today)
  const initialPickupTo = lastItem ? toDateInput(lastItem.pickupTo) : toDateInput(inAWeek)
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
            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הוספת פריטים</h2>
                {/* Only the capture-time queue actually carries these forward —
                    it is where a category and a pickup window are typed. The AI
                    import sets both on the review screen, across the batch, so
                    promising it here would be a promise about another screen. */}
                {!aiImport && initialCategory !== '' && (
                  <span className="carry">שדות ממשיכים מהפריט הקודם</span>
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
                  initialPickupFrom={initialPickupFrom}
                  initialPickupTo={initialPickupTo}
                />
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הפריטים שלי</h2>
              </div>
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
                              <span className={`${styles.pill} ${styles[STATUS_CLASS[item.status]]}`}>
                                {STATUS_LABEL[item.status]}
                              </span>
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
