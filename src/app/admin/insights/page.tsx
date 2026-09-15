import Link from 'next/link'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { photoUrl } from '@/lib/photo-url'
import { itemInterest, totals, visitorsByDay, type Window } from '@/lib/analytics/insights'
import { AdminNav } from '@/components/admin/AdminNav'
import { Price } from '@/components/Price'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './insights.module.css'

/** See src/app/admin/settings/page.tsx for why every admin page is forced dynamic. */
export const dynamic = 'force-dynamic'

const WINDOWS: { value: Window; label: string; param: string }[] = [
  { value: 7, label: '7 ימים', param: '7' },
  { value: 30, label: '30 יום', param: '30' },
  { value: null, label: 'מאז ומעולם', param: 'all' },
]

function readWindow(raw: string | string[] | undefined): Window {
  return raw === 'all' ? null : raw === '30' ? 30 : 7
}

/**
 * Who came, and what they looked at.
 *
 * The two halves answer different questions and only the second one changes
 * what the seller does. A visitor count says whether sharing the link worked;
 * the item table says which things people open and which of those they then
 * want — and the gap between those two columns is the useful number. Forty
 * people opened the dryer and none of them added it: the price is wrong.
 * Nobody opened the bookshelf at all: the photograph is wrong.
 *
 * Every number here comes from this shop's own database. There is no third
 * party involved, nothing is sent anywhere, and a visitor is a random id in a
 * cookie that cannot be turned back into a person.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const window = readWindow((await searchParams).window)

  const [counts, interest, byDay, items, itemCount, categoryCount, claimedCount] = await Promise.all([
    totals(window),
    itemInterest(window),
    visitorsByDay(14),
    db.item.findMany({
      include: { category: true, photos: { orderBy: { position: 'asc' }, take: 1 } },
    }),
    db.item.count(),
    db.category.count(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
  ])

  const byId = new Map(interest.map((row) => [row.itemId, row]))
  // Every item, including the ones nobody has opened — those are the most
  // actionable rows on the screen, and a table built from the event rows alone
  // would be exactly the table that cannot show them.
  const rows = items
    .map((item) => ({
      item,
      views: byId.get(item.id)?.views ?? 0,
      viewers: byId.get(item.id)?.viewers ?? 0,
      addsToCart: byId.get(item.id)?.addsToCart ?? 0,
    }))
    .sort((a, b) => b.viewers - a.viewers || b.views - a.views || a.item.name.localeCompare(b.item.name, 'he'))

  const busiest = Math.max(1, ...rows.map((row) => row.viewers))
  const peakDay = Math.max(1, ...byDay.map((day) => day.visitors))

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>תנועה באתר</h1>
          </div>
          <Link href="/" className="btn btn-ghost">
            צפייה בחנות ↗
          </Link>
        </div>
      </header>

      <div className="wrap">
        <div className={adminStyles.shell}>
          <AdminNav
            active="insights"
            itemCount={itemCount}
            ordersAlertCount={claimedCount}
            categoryCount={categoryCount}
          />

          <main className={styles.shell}>
            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>כמה אנשים נכנסו</h2>
                <div className={styles.windows}>
                  {WINDOWS.map((option) => (
                    <Link
                      key={option.param}
                      href={`/admin/insights?window=${option.param}`}
                      className={option.value === window ? `${styles.win} ${styles.winOn}` : styles.win}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className={styles.stats}>
                <Stat label="אנשים שונים" value={counts.visitors} hint="דפדפנים שונים, לא כניסות" />
                <Stat label="כניסות לחנות" value={counts.shopViews} />
                <Stat label="צפיות בפריטים" value={counts.itemViews} />
                <Stat label="הוספות לסל" value={counts.addsToCart} />
              </div>

              <h3 className={styles.sub}>אנשים שונים ביום, שבועיים אחרונים</h3>
              <div className={styles.days}>
                {byDay.map((day) => (
                  <div key={day.day} className={styles.day} title={`${day.day}: ${day.visitors}`}>
                    <div className={styles.dayBarWrap}>
                      <div
                        className={styles.dayBar}
                        style={{ height: `${Math.round((day.visitors / peakDay) * 100)}%` }}
                      />
                    </div>
                    <span className={styles.dayNum}>{day.visitors}</span>
                    <span className={styles.dayLabel}>{day.day.slice(8)}/{day.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>מה אנשים פותחים</h2>
              </div>

              {rows.length === 0 ? (
                <p className={styles.empty}>עדיין אין פריטים.</p>
              ) : counts.itemViews === 0 ? (
                <p className={styles.empty}>
                  עדיין לא נצפה אף פריט בטווח הזה. שתפו את הקישור לחנות — המספרים יתחילו להיכנס מיד.
                </p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>פריט</th>
                        <th>אנשים</th>
                        <th>צפיות</th>
                        <th>לסל</th>
                        <th className={styles.barCol}>עניין</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ item, views, viewers, addsToCart }) => {
                        const photo = item.photos[0]
                        return (
                          <tr key={item.id}>
                            <td data-label="פריט">
                              <Link href={`/admin/items/${item.id}`} className={styles.it}>
                                {photo ? (
                                  <img src={photoUrl(photo.id)} alt="" />
                                ) : (
                                  <span aria-hidden className={styles.noPhoto} />
                                )}
                                <span>
                                  <b>{item.name}</b>
                                  <small>
                                    {item.category.name} · <Price agorot={item.priceAgorot} />
                                  </small>
                                </span>
                              </Link>
                            </td>
                            <td data-label="אנשים">{viewers}</td>
                            <td data-label="צפיות">{views}</td>
                            <td data-label="לסל">{addsToCart}</td>
                            <td data-label="עניין" className={styles.barCol}>
                              {/* No bar at all for nobody, rather than a
                                  minimum-width sliver: "not one person opened
                                  this" is the most actionable row on the
                                  screen and must not look like "one person
                                  did". */}
                              {viewers === 0 ? (
                                <span className={styles.none}>—</span>
                              ) : (
                                <span
                                  className={styles.bar}
                                  style={{ width: `${Math.max(4, Math.round((viewers / busiest) * 100))}%` }}
                                  aria-hidden
                                />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className={styles.note}>
                &quot;אנשים&quot; הוא מספר הדפדפנים השונים שפתחו את הפריט, ו&quot;צפיות&quot; זה כמה פעמים בסך הכל.
                פריט שהרבה אנשים פותחים ומעטים מוסיפים לסל — כדאי לבדוק את המחיר. פריט שאף אחד לא פותח — כדאי לבדוק את
                התמונה הראשונה.
              </p>
            </section>
          </main>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statNum}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  )
}
