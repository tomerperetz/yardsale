'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { mergeCategoriesAction, dismissMergeAction } from './actions'
import styles from './categories.module.css'

type Props = {
  aId: string
  bId: string
  /** The survivor: every item on the other category moves here. Decided by the page (larger category wins). */
  fromId: string
  fromName: string
  intoId: string
  intoName: string
}

/**
 * `mergeCategories` reassigns every item off `fromId` and deletes it —
 * destructive and irreversible, so this never fires on a bare click. The
 * first click only opens an inline confirm state; nothing merges until
 * the seller explicitly confirms it here (no `window.confirm`).
 */
export function MergeBanner({ aId, bId, fromId, fromName, intoId, intoName }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState<'merge' | 'dismiss' | null>(null)

  async function doMerge() {
    setPending('merge')
    await mergeCategoriesAction(fromId, intoId)
    setPending(null)
    router.refresh()
  }

  async function doDismiss() {
    setPending('dismiss')
    await dismissMergeAction(aId, bId)
    setPending(null)
    router.refresh()
  }

  return (
    <div className={styles.merge}>
      {confirming ? (
        <>
          <span>
            לאחד את <b>״{fromName}״</b> לתוך <b>״{intoName}״</b>? כל הפריטים יעברו ל&quot;{intoName}&quot; והקטגוריה
            &quot;{fromName}&quot; תימחק. הפעולה בלתי הפיכה.
          </span>
          <span className={styles.sp} />
          <button type="button" className={`${styles.rowbtn} ${styles.go}`} onClick={doMerge} disabled={pending !== null}>
            {pending === 'merge' ? 'מאחד…' : 'כן, לאחד'}
          </button>
          <button type="button" className={styles.rowbtn} onClick={() => setConfirming(false)} disabled={pending !== null}>
            ביטול
          </button>
        </>
      ) : (
        <>
          <span>
            נראה ש<b>״{fromName}״</b> ו<b>״{intoName}״</b> הן אותה קטגוריה.
          </span>
          <span className={styles.sp} />
          <button type="button" className={`${styles.rowbtn} ${styles.go}`} onClick={() => setConfirming(true)}>
            איחוד
          </button>
          <button type="button" className={styles.rowbtn} onClick={doDismiss} disabled={pending !== null}>
            {pending === 'dismiss' ? '…' : 'התעלמות'}
          </button>
        </>
      )}
    </div>
  )
}
