import Link from 'next/link'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { suggestMerges } from '@/lib/admin/categories'
import { AdminNav } from '@/components/admin/AdminNav'
import { FirstRunChecklist } from '@/components/admin/FirstRunChecklist'
import { CategoryRow } from './CategoryRow'
import { MergeBanner } from './MergeBanner'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './categories.module.css'

/**
 * Categories are created implicitly — typing a new one into the item form
 * makes it exist (`src/lib/admin/items.ts`, `categoryId`). This screen is
 * only for tidying afterwards: rename a typo, or merge two that turned
 * out to be the same category. `suggestMerges` flags likely duplicates;
 * `mergeCategories` is destructive, so `MergeBanner` requires an explicit
 * inline confirmation before it ever runs.
 */
// See src/app/admin/settings/page.tsx for why this is forced dynamic.
export const dynamic = 'force-dynamic'

export default async function AdminCategoriesPage() {
  await releaseExpiredHolds()

  const [categories, settings, itemCount, claimedCount] = await Promise.all([
    db.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } }),
    getSettings(),
    db.item.count(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
  ])

  const byId = new Map(categories.map((c) => [c.id, c]))
  const suggestions = suggestMerges(
    categories.map((c) => ({ id: c.id, name: c.name })),
    settings.dismissedMerges,
  )

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>ניהול קטגוריות</h1>
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
            active="categories"
            itemCount={itemCount}
            ordersAlertCount={claimedCount}
            categoryCount={categories.length}
          />

          <main>
            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>קטגוריות</h2>
              </div>
              <p className={styles.psub}>
                נוצרות מעצמן כשמקלידים קטגוריה חדשה בפריט. כאן משנים שם או מאחדים שתיים שנוצרו בטעות.
              </p>

              {categories.length === 0 ? (
                <p className={styles.empty}>עדיין אין קטגוריות.</p>
              ) : (
                <div className={styles.catgrid}>
                  {categories.map((c) => (
                    <CategoryRow key={c.id} id={c.id} name={c.name} count={c._count.items} />
                  ))}
                </div>
              )}

              {suggestions.map((s) => {
                const a = byId.get(s.aId)
                const b = byId.get(s.bId)
                if (!a || !b) return null
                // The larger category survives; the smaller one's items move into it and it is deleted.
                const [into, from] = a._count.items >= b._count.items ? [a, b] : [b, a]
                return (
                  <MergeBanner
                    key={`${s.aId}:${s.bId}`}
                    aId={s.aId}
                    bId={s.bId}
                    fromId={from.id}
                    fromName={from.name}
                    intoId={into.id}
                    intoName={into.name}
                  />
                )
              })}
            </section>
          </main>
        </div>
      </div>
    </>
  )
}
