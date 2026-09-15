'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { rewriteDescriptionsAction } from './actions'
import styles from './items.module.css'

/**
 * Rewrites every listing's description from its own photographs.
 *
 * It exists because the copy pass only ever ran on the way in. Items listed
 * before the import existed kept whatever was typed at the time, and some of
 * those are not descriptions at all — one item's reads as the name of its own
 * category, another's repeats its own title. A buyer deciding whether to drive
 * across town reads exactly this field.
 *
 * Two things it owes the seller before it runs:
 *
 * 1. The count. Every item is a paid model call, and this is the only control
 *    in the app that spends money per row. It says how many before it asks.
 * 2. What it will overwrite, in the same breath — descriptions, and nothing
 *    else. A seller who has written twenty descriptions by hand must not learn
 *    that this replaces them by watching it happen.
 *
 * The confirmation is the same shape as the pickup-window bar's above it, on
 * purpose: the two shop-wide actions on this screen should not need to be
 * learned separately.
 */
export function DescriptionsBulk({ rewritable, aiOn }: { rewritable: number; aiOn: boolean }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function apply() {
    if (busy) return
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      const result = await rewriteDescriptionsAction()
      setConfirming(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFlash(doneMessage(result.rewritten, result.failed, result.reason))
      router.refresh()
    } catch (err) {
      console.error('[items] rewriting the descriptions failed:', err)
      setConfirming(false)
      setError('שגיאה בשיפור התיאורים. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.windowBulk}>
      {confirming ? (
        <div className={styles.windowConfirm}>
          <span>{`לכתוב מחדש את התיאור של ${itemCount(rewritable)}?`}</span>
          <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void apply()}>
            {busy ? 'כותב…' : 'כן, לשפר'}
          </button>
          <button type="button" className={styles.windowBtn} disabled={busy} onClick={() => setConfirming(false)}>
            ביטול
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.windowBtn}
          disabled={busy || rewritable === 0 || !aiOn}
          onClick={() => {
            setFlash(null)
            setError(null)
            setConfirming(true)
          }}
        >
          שיפור התיאורים
        </button>
      )}

      <p className={styles.windowNote}>{note(rewritable, aiOn)}</p>

      {error && (
        <p className={styles.windowError} role="alert">
          {error}
        </p>
      )}
      {flash && (
        <p className={styles.windowFlash} role="status">
          {flash}
        </p>
      )}
    </section>
  )
}

/** "פריט אחד" / "7 פריטים" — Hebrew counts one item by name, not by number. */
function itemCount(n: number): string {
  return n === 1 ? 'פריט אחד' : `${n} פריטים`
}

/**
 * What the button will do, said before it is pressed — including the word
 * "בלבד", because the difference between rewriting a description and
 * rewriting a listing is the whole reason this is safe to press.
 */
function note(rewritable: number, aiOn: boolean): string {
  if (!aiOn) return 'שיפור תיאורים אוטומטי כבוי: לא הוגדר מפתח API.'
  if (rewritable === 0) return 'אין פריטים עם תמונות לשפר. פריטים שנמכרו לא משתנים.'
  return `נכתוב מחדש את התיאור של ${itemCount(rewritable)} לפי התמונות שלהם. השם, הקטגוריה והמחיר לא ישתנו, ופריטים שנמכרו לא ייגעו.`
}

/** What happened, in the numbers the server came back with. */
function doneMessage(rewritten: number, failed: number, reason: string | null): string {
  const done = rewritten === 0 ? 'לא שונה אף תיאור.' : `נכתבו מחדש התיאורים של ${itemCount(rewritten)}.`
  if (failed === 0) return done
  if (reason === 'OUT_OF_CREDIT') {
    return `${done} השאר נעצרו: אין יתרה בחשבון הבינה המלאכותית.`
  }
  return `${done} ${itemCount(failed)} לא השתנו והתיאור הקודם שלהם נשמר.`
}
