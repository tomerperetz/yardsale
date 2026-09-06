import Link from 'next/link'
import styles from './admin.module.css'

export type AdminActiveRoute = 'items' | 'orders' | 'categories' | 'settings'

type AdminNavProps = {
  active: AdminActiveRoute
  itemCount: number
  /** Orders in CLAIMED_PAID — the buyer says they paid and the seller has not confirmed yet. */
  ordersAlertCount: number
  categoryCount: number
}

/**
 * The seller's admin sidebar (`docs/design/mockups/04-admin-orders.html`,
 * `nav.side`). The orders badge is the whole point of this component: it
 * counts CLAIMED_PAID orders, the one state that actually needs the seller
 * to act, so it stays visible everywhere — including the collapsed phone
 * layout below, which turns the vertical sidebar into a horizontal strip
 * instead of eating a third of a phone's width.
 */
export function AdminNav({ active, itemCount, ordersAlertCount, categoryCount }: AdminNavProps) {
  return (
    <nav className={styles.side} aria-label="ניהול">
      <Link href="/admin/items" className={active === 'items' ? `${styles.navLink} ${styles.navOn}` : styles.navLink}>
        פריטים <span className={styles.navCount}>{itemCount}</span>
      </Link>
      <Link href="/admin/orders" className={active === 'orders' ? `${styles.navLink} ${styles.navOn}` : styles.navLink}>
        הזמנות{' '}
        <span className={ordersAlertCount > 0 ? `${styles.navCount} ${styles.navAlert}` : styles.navCount}>
          {ordersAlertCount}
        </span>
      </Link>
      <Link
        href="/admin/categories"
        className={active === 'categories' ? `${styles.navLink} ${styles.navOn}` : styles.navLink}
      >
        קטגוריות <span className={styles.navCount}>{categoryCount}</span>
      </Link>
      <div className={styles.navSep} aria-hidden="true" />
      <Link
        href="/admin/settings"
        className={active === 'settings' ? `${styles.navLink} ${styles.navOn}` : styles.navLink}
      >
        הגדרות מכירה
      </Link>
    </nav>
  )
}
