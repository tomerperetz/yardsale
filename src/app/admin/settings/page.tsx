import Link from 'next/link'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { releaseExpiredHolds } from '@/lib/orders/sweep'
import { AdminNav } from '@/components/admin/AdminNav'
import { FirstRunChecklist } from '@/components/admin/FirstRunChecklist'
import { SettingsForm } from './SettingsForm'
import adminStyles from '@/components/admin/admin.module.css'
import styles from './settings.module.css'

/**
 * The form over the `Settings` singleton row — shop identity, the BIT
 * number, pickup address/city, the three slot hour labels, and the hold
 * length. Nothing here is hardcoded: a shop with every field still empty
 * renders every field empty, and `FirstRunChecklist` above points right
 * back here until the required ones are filled in.
 */
// Every admin page must read the live DB on every request — a stale
// statically-prerendered settings/order/category snapshot served to the
// seller would be actively wrong, not just outdated. Pages with a
// `searchParams` param (items, orders) are forced dynamic by Next
// automatically; this one and /admin/categories take no dynamic input, so
// they need the export explicitly or Next tries to prerender them at
// build time — which also fails outright whenever the build-time DB has
// no seeded Settings row yet.
export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  await releaseExpiredHolds()

  const [settings, itemCount, categoryCount, claimedCount] = await Promise.all([
    getSettings(),
    db.item.count(),
    db.category.count(),
    db.order.count({ where: { status: OrderStatus.CLAIMED_PAID } }),
  ])

  return (
    <>
      <header>
        <div className="wrap bar">
          <div className="brand">
            <div className="mark" />
            <h1>הגדרות מכירה</h1>
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
            active="settings"
            itemCount={itemCount}
            ordersAlertCount={claimedCount}
            categoryCount={categoryCount}
          />

          <main>
            <section className={styles.panel}>
              <div className={styles.ptitle}>
                <h2>הגדרות מכירה</h2>
              </div>
              <p className={styles.psub}>
                הפרטים כאן מופיעים בדף החנות, בהודעות הוואטסאפ לקונים ובדף התשלום בביט.
              </p>

              <SettingsForm
                settings={{
                  shopName: settings.shopName,
                  tagline: settings.tagline,
                  bitPhone: settings.bitPhone,
                  addressLine: settings.addressLine,
                  city: settings.city,
                  slotMorning: settings.slotMorning,
                  slotAfternoon: settings.slotAfternoon,
                  slotEvening: settings.slotEvening,
                  holdMinutes: String(settings.holdMinutes),
                }}
              />
            </section>
          </main>
        </div>
      </div>
    </>
  )
}
