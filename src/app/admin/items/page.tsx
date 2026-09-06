import Link from 'next/link'
import { db } from '@/lib/db'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { ItemForm } from '@/components/admin/ItemForm'
import { BulkQueue } from '@/components/admin/BulkQueue'
import { PickupWindow } from '@/components/PickupWindow'
import { Price } from '@/components/Price'
import styles from './items.module.css'

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'זמין',
  RESERVED: 'שמור',
  SOLD: 'נמכר',
  DRAFT: 'טיוטה',
}
const STATUS_CLASS: Record<string, string> = {
  AVAILABLE: 'ok',
  RESERVED: 'hold',
  SOLD: 'sold',
  DRAFT: 'draft',
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The seller's item-entry screen: a mode toggle between the single-item form
 * and the bulk queue, plus the item table below. No sidebar nav — Task 19
 * owns AdminNav.tsx and the orders/categories/settings routes it would link
 * to, so this page doesn't fake links to pages that don't exist yet.
 *
 * Category and pickup window "carry forward" from the most recently created
 * item (across page loads, not just within one session) so a returning
 * seller doesn't have to re-pick them every visit.
 */
export default async function AdminItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await releaseExpiredHolds()

  const params = await searchParams
  const mode = params.mode === 'bulk' ? 'bulk' : 'single'

  const [items, categories, lastItem] = await Promise.all([
    db.item.findMany({
      orderBy: { createdAt: 'desc' },
      include: { category: true, photos: { orderBy: { position: 'asc' } } },
    }),
    db.category.findMany({ orderBy: { name: 'asc' } }),
    db.item.findFirst({ orderBy: { createdAt: 'desc' }, include: { category: true } }),
  ])

  const today = new Date()
  const inAWeek = new Date(today.getTime() + 6 * 86_400_000)

  const initialCategory = lastItem?.category.name ?? categories[0]?.name ?? ''
  const initialPickupFrom = lastItem ? toDateInput(lastItem.pickupFrom) : toDateInput(today)
  const initialPickupTo = lastItem ? toDateInput(lastItem.pickupTo) : toDateInput(inAWeek)
  const categoryNames = categories.map((c) => c.name)
  const listedCount = items.filter((i) => i.status === 'AVAILABLE' || i.status === 'RESERVED').length

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

      <div className={`wrap ${styles.shell}`}>
        <section className={styles.panel}>
          <div className={styles.ptitle}>
            <h2>{mode === 'single' ? 'פריט חדש' : 'העלאה מרוכזת'}</h2>
            {initialCategory !== '' && <span className="carry">שדות ממשיכים מהפריט הקודם</span>}
          </div>
          <p className={styles.psub}>
            {mode === 'single'
              ? 'גוררים תמונות, ממלאים ארבעה שדות, שומרים וממשיכים לבא. הקטגוריה וחלון האיסוף נשמרים אוטומטית.'
              : 'גוררים את כל התמונות בבת אחת. כל קבוצה נפתחת כפריט, ואתם יורדים בתור וממלאים רק את מה שמשתנה.'}
          </p>

          <div className={styles.modes}>
            <Link href="/admin/items" className={mode === 'single' ? styles.on : undefined}>
              פריט אחד
            </Link>
            <Link href="/admin/items?mode=bulk" className={mode === 'bulk' ? styles.on : undefined}>
              העלאה מרוכזת
            </Link>
          </div>

          {mode === 'single' ? (
            <ItemForm
              categories={categoryNames}
              initialCategory={initialCategory}
              initialPickupFrom={initialPickupFrom}
              initialPickupTo={initialPickupTo}
              itemCount={listedCount}
            />
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
            <div style={{ overflowX: 'auto' }}>
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
                        <td>
                          <span className={styles.it}>
                            {photo ? (
                              <img src={`/img/${item.id}/${photo.id}-400.webp`} alt="" />
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
                        <td>{item.category.name}</td>
                        <td>
                          <Price agorot={item.priceAgorot} />
                        </td>
                        <td>
                          {item.status === 'SOLD' ? '—' : <PickupWindow from={item.pickupFrom} to={item.pickupTo} />}
                        </td>
                        <td>
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
      </div>
    </>
  )
}
