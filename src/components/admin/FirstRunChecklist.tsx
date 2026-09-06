import Link from 'next/link'
import type { Settings } from '@prisma/client'
import { missingSettings } from '@/lib/settings'
import styles from './admin.module.css'

const LABELS: Record<string, string> = {
  shopName: 'שם החנות',
  bitPhone: 'מספר טלפון לביט',
  addressLine: 'כתובת',
  city: 'עיר',
}

/**
 * Shown at the top of every admin page while `missingSettings()` is
 * non-empty. `bitPhone` is called out by name because it's the one field
 * `shopIsOpen` gates on — without it a buyer could reserve items with no
 * way to pay (see `src/lib/settings.ts`).
 */
export function FirstRunChecklist({ settings }: { settings: Settings }) {
  const missing = missingSettings(settings)
  if (missing.length === 0) return null

  const blocksSales = missing.includes('bitPhone')

  return (
    <div className={styles.checklist}>
      <div className={styles.checklistHead}>
        <b>עוד כמה פרטים לפני שהחנות מוכנה</b>
        {blocksSales && <span className={styles.checklistAlert}>אי אפשר לקבל הזמנות בלי מספר ביט</span>}
      </div>
      <ul className={styles.checklistList}>
        {missing.map((key) => (
          <li key={key}>
            {LABELS[key] ?? key}
            {key === 'bitPhone' && <span className={styles.checklistBlock}> · חוסם מכירה</span>}
          </li>
        ))}
      </ul>
      <Link href="/admin/settings" className={`btn btn-accent ${styles.checklistBtn}`}>
        להגדרות
      </Link>
    </div>
  )
}
